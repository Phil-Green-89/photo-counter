import { describe, expect, it } from 'vitest'
import { decode, detectAll, iou, letterbox, nms, tilesFor, unletterbox, type Det, type Rect } from './yolo'

describe('decode', () => {
  it('reads channel-major boxes and keeps only confident ones', () => {
    // n=3 anchors, nc=1: rows are cx, cy, w, h, score
    const out = [10, 20, 30, /*cx*/ 11, 21, 31, /*cy*/ 4, 5, 6, /*w*/ 7, 8, 9, /*h*/ 0.9, 0.1, 0.6]
    const d = decode(out, 3, 1, 0.25)
    expect(d).toEqual([
      { x: 10, y: 11, w: 4, h: 7, score: 0.9 },
      { x: 30, y: 31, w: 6, h: 9, score: 0.6 },
    ])
  })
  it('uses the best class score', () => {
    const out = [5, 5, 2, 2, 0.1, 0.8]
    expect(decode(out, 1, 2, 0.5)[0].score).toBe(0.8)
  })
})

describe('nms', () => {
  const box = (x: number, score: number): Det => ({ x, y: 0, w: 10, h: 10, score })
  it('keeps the best of overlapping boxes and all separate ones', () => {
    const kept = nms([box(0, 0.5), box(2, 0.9), box(100, 0.4)], 0.5)
    expect(kept.map(k => k.score)).toEqual([0.9, 0.4])
  })
  it('keeps touching neighbours (pipes in a bundle)', () => {
    expect(nms([box(0, 0.9), box(10, 0.8), box(20, 0.7)], 0.5)).toHaveLength(3)
  })
  it('iou of disjoint boxes is 0 and identical is 1', () => {
    expect(iou(box(0, 1), box(50, 1))).toBe(0)
    expect(iou(box(0, 1), box(0, 1))).toBeCloseTo(1)
  })
})

describe('letterbox', () => {
  it('round-trips a point through the model input back to image coordinates', () => {
    const W = 1600, H = 900, crop = { x: 100, y: 50, w: W, h: H }
    const lb = letterbox(W, H, 640)
    // an item at image (500,400) lands at ((500-100)*s+padX, (400-50)*s+padY) in model space
    const model: Det = { x: 400 * lb.scale + lb.padX, y: 350 * lb.scale + lb.padY, w: 40 * lb.scale, h: 40 * lb.scale, score: 1 }
    const [d] = unletterbox([model], lb, crop)
    expect(d.x).toBeCloseTo(500); expect(d.y).toBeCloseTo(400); expect(d.w).toBeCloseTo(40)
  })
})

describe('tilesFor', () => {
  it('covers the whole image with overlap', () => {
    const W = 1000, H = 800
    const t = tilesFor(W, H, 3, 0.2)
    expect(t).toHaveLength(9)
    expect(Math.min(...t.map(r => r.x))).toBe(0)
    expect(Math.max(...t.map(r => r.x + r.w))).toBeCloseTo(W)
    expect(Math.max(...t.map(r => r.y + r.h))).toBeCloseTo(H)
    const [a, b] = t
    expect(a.x + a.w).toBeGreaterThan(b.x) // neighbours overlap
  })
})

/** Fake "model": sees circles at its input resolution, misses ones under 8px, and emits fragments at crop edges. */
function fakeModel(truth: { x: number; y: number; r: number }[], inputSize = 640) {
  let runs = 0
  const run = async (crop: Rect): Promise<Det[]> => {
    runs++
    const scale = inputSize / Math.max(crop.w, crop.h)
    const out: Det[] = []
    for (const c of truth) {
      if (c.r * 2 * scale < 8) continue
      const l = Math.max(c.x - c.r, crop.x), r = Math.min(c.x + c.r, crop.x + crop.w)
      const u = Math.max(c.y - c.r, crop.y), b = Math.min(c.y + c.r, crop.y + crop.h)
      if (r <= l || b <= u) continue
      if ((r - l) * (b - u) < 0.6 * (2 * c.r) ** 2) continue
      out.push({ x: (l + r) / 2, y: (u + b) / 2, w: r - l, h: b - u, score: 0.9 })
    }
    return out
  }
  return { run, runs: () => runs }
}

const lattice = (cols: number, rows: number, pitch: number, r: number, W: number, H: number) => {
  const out: { x: number; y: number; r: number }[] = []
  const x0 = (W - (cols - 1) * pitch) / 2, y0 = (H - (rows - 1) * pitch) / 2
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: x0 + i * pitch, y: y0 + j * pitch, r })
  return out
}

describe('detectAll scale policy', () => {
  const o = { iou: 0.5, inputSize: 640 }

  it('one pass when items are comfortably large', async () => {
    const truth = lattice(6, 4, 150, 60, 1200, 900)
    const m = fakeModel(truth)
    expect(await detectAll(1200, 900, m.run, o)).toHaveLength(24)
    expect(m.runs()).toBe(1)
  })

  it('tiles when items are small in the frame and recovers ones the global pass cannot see', async () => {
    const truth = lattice(14, 10, 120, 20, 4000, 3000) // 40px pipes in a 4000px photo → 6px at 640
    const m = fakeModel(truth)
    const dets = await detectAll(4000, 3000, m.run, o)
    expect(dets).toHaveLength(140)
    expect(m.runs()).toBeGreaterThan(1)
  })

  it('does not double count items that sit in tile overlaps', async () => {
    const truth = lattice(12, 9, 120, 24, 4000, 3000)
    const dets = await detectAll(4000, 3000, fakeModel(truth).run, o)
    expect(dets).toHaveLength(108)
  })

  it('never returns fewer than the global pass', async () => {
    const global: Det[] = [{ x: 10, y: 10, w: 5, h: 5, score: 1 }, { x: 40, y: 40, w: 5, h: 5, score: 1 }]
    let call = 0
    const run = async () => (call++ === 0 ? global : [])
    expect(await detectAll(2000, 2000, run, o)).toHaveLength(2)
  })
})
