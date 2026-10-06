import type { Dot, Box } from '../infer/exemplar'
import type { Lighting } from '../infer/lighting'

export const ITEMS = [
  { id: 'pipes', icon: '⭕', label: 'Pipes' },
  { id: 'rebar', icon: '🔩', label: 'Rebar' },
  { id: 'lumber', icon: '🪵', label: 'Lumber' },
  { id: 'boxes', icon: '📦', label: 'Boxes' },
  { id: 'bottles', icon: '🍾', label: 'Bottles' },
  { id: 'bags', icon: '🛍️', label: 'Bags' },
  { id: 'pallets', icon: '🟫', label: 'Pallets' },
  { id: 'other', icon: '👆', label: 'Other' },
] as const
export type ItemId = typeof ITEMS[number]['id']

const USE_KEY = 'pc.use'
const CONSENT_KEY = 'pc.share'
const DEVICE_KEY = 'pc.device'

function safeGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export function useCounts(): Record<string, number> {
  try { return JSON.parse(safeGet(USE_KEY) ?? '{}') } catch { return {} }
}

export function bumpUse(id: ItemId) {
  const c = useCounts()
  c[id] = (c[id] ?? 0) + 1
  safeSet(USE_KEY, JSON.stringify(c))
}

/** Items most-used first; ties and unused items keep their default order. */
export function orderedItems() {
  const c = useCounts()
  return [...ITEMS].sort((a, b) => (c[b.id] ?? 0) - (c[a.id] ?? 0))
}

/** null = not asked yet, true/false = the user's answer to "share photos to improve counting?" */
export function getConsent(): boolean | null {
  const v = safeGet(CONSENT_KEY)
  return v === null ? null : v === '1'
}
export function setConsent(v: boolean) { safeSet(CONSENT_KEY, v ? '1' : '0') }

/** Random id, not tied to a person. Lets us see how many devices contribute, nothing more. */
export function deviceId(): string {
  let id = safeGet(DEVICE_KEY)
  if (!id) { id = crypto.randomUUID(); safeSet(DEVICE_KEY, id) }
  return id
}

export interface FeedbackRecord {
  id?: number
  at: number
  item: ItemId
  image: Blob
  imgW: number
  imgH: number
  exemplar: Box
  modelDots: Dot[]
  finalDots: Dot[]
  thumbsUp: boolean | null
  lighting: Lighting
  modelVersion: string
  uploaded: 0 | 1
}

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('photo-counter', 1)
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore('feedback', { keyPath: 'id', autoIncrement: true })
      s.createIndex('uploaded', 'uploaded')
    }
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(d => new Promise<T>((res, rej) => {
    const t = d.transaction('feedback', mode)
    const r = fn(t.objectStore('feedback'))
    t.oncomplete = () => res(r.result)
    t.onerror = () => rej(t.error)
    t.onabort = () => rej(t.error)
  }))
}

/** Storage can be unavailable (private mode, quota). Counting must keep working, so never throw. */
export async function saveFeedback(rec: FeedbackRecord): Promise<number | null> {
  try { return (await tx('readwrite', s => s.add(rec))) as number } catch { return null }
}

/** Replace an existing record (e.g. the user changed 👍 to 👎 or kept editing dots). */
export async function updateFeedback(rec: FeedbackRecord): Promise<void> {
  try { await tx('readwrite', s => s.put(rec)) } catch { /* ignore */ }
}

export async function listPending(): Promise<FeedbackRecord[]> {
  try {
    const all = (await tx('readonly', s => s.index('uploaded').getAll(0))) as FeedbackRecord[]
    return all.sort((a, b) => priority(b) - priority(a) || a.at - b.at)
  } catch { return [] }
}

/** Where the model is weakest uploads first: poor light, then dim, then thumbs-down. */
function priority(r: FeedbackRecord): number {
  return (r.lighting.bucket === 'poor' ? 4 : r.lighting.bucket === 'dim' ? 2 : 0) + (r.thumbsUp === false ? 1 : 0)
}

export async function markUploaded(id: number): Promise<void> {
  try {
    const rec = (await tx('readonly', s => s.get(id))) as FeedbackRecord | undefined
    if (rec) await tx('readwrite', s => s.put({ ...rec, uploaded: 1, image: new Blob() }))
  } catch { /* ignore */ }
}

export async function pendingCount(): Promise<number> {
  try { return (await tx('readonly', s => s.index('uploaded').count(0))) as number } catch { return 0 }
}
