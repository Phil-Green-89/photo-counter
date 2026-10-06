import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPending, markUploaded, saveFeedback, setConsent, type FeedbackRecord } from './store'
import { scaleRow, syncPending } from './sync'

const rec = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  at: 1, item: 'pipes', image: new Blob(['x']), imgW: 2560, imgH: 1280,
  exemplar: { x: 100, y: 200, w: 60, h: 60 }, modelDots: [{ x: 200, y: 400 }],
  finalDots: [{ x: 200, y: 400 }, { x: 600, y: 800 }], thumbsUp: false,
  lighting: { mean: 30, contrast: 10, bucket: 'poor' }, modelVersion: 'ncc-v0', uploaded: 0, ...over,
})
const shrink = async () => new Blob(['jpg'], { type: 'image/jpeg' })
const ok = () => new Response(null, { status: 201 })

beforeEach(async () => {
  localStorage.clear()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://demo.supabase.co/')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  for (const r of await listPending()) await markUploaded(r.id!)
})
afterEach(() => vi.unstubAllEnvs())

describe('scaleRow', () => {
  it('scales all coordinates with the shrunk image', () => {
    const row = scaleRow(rec(), 0.5)
    expect(row.img_w).toBe(1280)
    expect(row.exemplar).toEqual({ x: 50, y: 100, w: 30, h: 30 })
    expect(row.final_dots).toEqual([{ x: 100, y: 200 }, { x: 300, y: 400 }])
  })
})

describe('syncPending', () => {
  it('does nothing until the user has opted in', async () => {
    await saveFeedback(rec())
    const f = vi.fn(async () => ok())
    expect(await syncPending(f as unknown as typeof fetch, shrink)).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })

  it('does nothing when the backend is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    setConsent(true)
    await saveFeedback(rec())
    const f = vi.fn(async () => ok())
    expect(await syncPending(f as unknown as typeof fetch, shrink)).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })

  it('uploads the photo then the row, with the public key only, and marks it sent', async () => {
    setConsent(true)
    await saveFeedback(rec())
    const f = vi.fn(async () => ok())
    expect(await syncPending(f as unknown as typeof fetch, shrink)).toBe(1)

    const [imgUrl, imgInit] = f.mock.calls[0] as unknown as [string, RequestInit]
    const [rowUrl, rowInit] = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(imgUrl).toMatch(/^https:\/\/demo\.supabase\.co\/storage\/v1\/object\/feedback-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/)
    expect(rowUrl).toBe('https://demo.supabase.co/rest/v1/feedback')
    expect((imgInit.headers as Record<string, string>).apikey).toBe('anon-key')
    const body = JSON.parse(rowInit.body as string)
    expect(body).toMatchObject({ item: 'pipes', lighting_bucket: 'poor', thumbs_up: false, img_w: 1280 })
    expect(imgUrl.endsWith(body.image_path)).toBe(true)
    expect(await listPending()).toHaveLength(0)
  })

  it('keeps records queued and stops when the network fails', async () => {
    setConsent(true)
    await saveFeedback(rec({ at: 1 }))
    await saveFeedback(rec({ at: 2 }))
    const f = vi.fn(async () => { throw new TypeError('offline') })
    expect(await syncPending(f as unknown as typeof fetch, shrink)).toBe(0)
    expect(f).toHaveBeenCalledTimes(1)
    expect(await listPending()).toHaveLength(2)
  })

  it('keeps the record when the server rejects the row', async () => {
    setConsent(true)
    await saveFeedback(rec())
    const f = vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect(await syncPending(f as unknown as typeof fetch, shrink)).toBe(0)
    expect(await listPending()).toHaveLength(1)
  })
})
