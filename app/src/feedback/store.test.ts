import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  bumpUse, getConsent, listPending, markUploaded, orderedItems, pendingCount, saveFeedback, setConsent,
  type FeedbackRecord,
} from './store'

const rec = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  at: 1, item: 'pipes', image: new Blob(['x']), imgW: 100, imgH: 80,
  exemplar: { x: 1, y: 1, w: 10, h: 10 }, modelDots: [], finalDots: [], thumbsUp: null,
  lighting: { mean: 120, contrast: 40, bucket: 'good' }, modelVersion: 't', uploaded: 0, ...over,
})

beforeEach(async () => {
  localStorage.clear()
  const all = await listPending()
  for (const r of all) await markUploaded(r.id!)
})

describe('habit memory', () => {
  it('puts the most-counted item first', () => {
    expect(orderedItems()[0].id).toBe('pipes')
    bumpUse('boxes'); bumpUse('boxes'); bumpUse('rebar')
    const ids = orderedItems().map(i => i.id)
    expect(ids.slice(0, 2)).toEqual(['boxes', 'rebar'])
  })
})

describe('consent', () => {
  it('is unanswered until set, then remembered', () => {
    expect(getConsent()).toBeNull()
    setConsent(true); expect(getConsent()).toBe(true)
    setConsent(false); expect(getConsent()).toBe(false)
  })
})

describe('pending feedback queue', () => {
  it('uploads poor light first, then dim, then thumbs-down, then oldest', async () => {
    await saveFeedback(rec({ at: 1, lighting: { mean: 130, contrast: 40, bucket: 'good' } }))
    await saveFeedback(rec({ at: 2, lighting: { mean: 60, contrast: 20, bucket: 'dim' } }))
    await saveFeedback(rec({ at: 3, lighting: { mean: 20, contrast: 8, bucket: 'poor' } }))
    await saveFeedback(rec({ at: 4, thumbsUp: false }))
    const order = (await listPending()).map(r => r.at)
    expect(order).toEqual([3, 2, 4, 1])
  })

  it('drops the photo and leaves the queue once uploaded', async () => {
    const id = (await saveFeedback(rec()))!
    expect(await pendingCount()).toBe(1)
    await markUploaded(id)
    expect(await pendingCount()).toBe(0)
  })
})
