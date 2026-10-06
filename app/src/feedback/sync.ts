import { deviceId, getConsent, listPending, markUploaded, type FeedbackRecord } from './store'

export interface SyncConfig { url: string; anonKey: string }

export function syncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return url && anonKey ? { url: url.replace(/\/$/, ''), anonKey } : null
}

const MAX_SIDE = 1280

/** Shrink to ≤1280px JPEG so free-tier storage lasts and mobile data isn't wasted. */
export async function shrinkImage(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * s)
  c.height = Math.round(bmp.height * s)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.8))
}

/** Coordinates in the record are in the original image's pixels; scale them with the shrunk image. */
export function scaleRow(rec: FeedbackRecord, scale: number) {
  const d = (p: { x: number; y: number }) => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale) })
  return {
    exemplar: {
      x: Math.round(rec.exemplar.x * scale), y: Math.round(rec.exemplar.y * scale),
      w: Math.round(rec.exemplar.w * scale), h: Math.round(rec.exemplar.h * scale),
    },
    model_dots: rec.modelDots.map(d),
    final_dots: rec.finalDots.map(d),
    img_w: Math.round(rec.imgW * scale),
    img_h: Math.round(rec.imgH * scale),
  }
}

export async function uploadOne(
  cfg: SyncConfig, rec: FeedbackRecord, f: typeof fetch = fetch, shrink: typeof shrinkImage = shrinkImage,
): Promise<void> {
  const jpg = await shrink(rec.image)
  const scale = Math.min(1, MAX_SIDE / Math.max(rec.imgW, rec.imgH))
  const rowId = crypto.randomUUID()
  const device = deviceId()
  const path = `${device}/${rowId}.jpg`
  const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` }

  const up = await f(`${cfg.url}/storage/v1/object/feedback-images/${path}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body: jpg,
  })
  if (!up.ok) throw new Error(`image upload ${up.status}`)

  const row = await f(`${cfg.url}/rest/v1/feedback`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: rowId, device_id: device, item: rec.item, model_version: rec.modelVersion,
      lighting_bucket: rec.lighting.bucket, lighting_mean: rec.lighting.mean, lighting_contrast: rec.lighting.contrast,
      thumbs_up: rec.thumbsUp, image_path: path, ...scaleRow(rec, scale),
    }),
  })
  if (!row.ok) throw new Error(`row insert ${row.status}`)
}

let running = false

/** Upload pending records if the user opted in. Stops at the first network failure; retried next time. */
export async function syncPending(f: typeof fetch = fetch, shrink: typeof shrinkImage = shrinkImage): Promise<number> {
  const cfg = syncConfig()
  if (!cfg || getConsent() !== true || running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  running = true
  let sent = 0
  try {
    for (const rec of await listPending()) {
      try {
        await uploadOne(cfg, rec, f, shrink)
        await markUploaded(rec.id!)
        sent++
      } catch { break }
    }
  } finally { running = false }
  return sent
}
