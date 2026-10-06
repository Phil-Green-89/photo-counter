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

/** Items most-used first; unused items keep their default order. */
export function orderedItems() {
  const c = useCounts()
  return [...ITEMS].sort((a, b) => (c[b.id] ?? 0) - (c[a.id] ?? 0))
}

export interface FeedbackRecord {
  id?: number
  at: number
  item: ItemId
  image: Blob
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

export async function saveFeedback(rec: FeedbackRecord): Promise<void> {
  try {
    const d = await db()
    await new Promise<void>((res, rej) => {
      const tx = d.transaction('feedback', 'readwrite')
      tx.objectStore('feedback').add(rec)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch { /* storage unavailable: counting still works */ }
}
