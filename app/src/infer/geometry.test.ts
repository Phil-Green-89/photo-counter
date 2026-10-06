import { describe, expect, it } from 'vitest'
import { apply, homography, invert, orderCorners, rectSize, validQuad, warpRGBA, type Pt } from './geometry'

const quad: Pt[] = [{ x: 120, y: 80 }, { x: 520, y: 40 }, { x: 560, y: 330 }, { x: 60, y: 300 }]
const rect = (w: number, h: number): Pt[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]

describe('homography', () => {
  it('maps each corner to its target', () => {
    const H = homography(quad, rect(400, 250))
    quad.forEach((p, i) => {
      const q = apply(H, p)
      expect(q.x).toBeCloseTo(rect(400, 250)[i].x, 4)
      expect(q.y).toBeCloseTo(rect(400, 250)[i].y, 4)
    })
  })
  it('inverse round-trips arbitrary points', () => {
    const H = homography(quad, rect(400, 250)), Hi = invert(H)
    for (const p of [{ x: 200, y: 150 }, { x: 333, y: 222 }, { x: 99, y: 280 }]) {
      const r = apply(Hi, apply(H, p))
      expect(r.x).toBeCloseTo(p.x, 4); expect(r.y).toBeCloseTo(p.y, 4)
    }
  })
  it('rejects three collinear corners', () => {
    expect(() => homography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 5, y: 0 }], rect(10, 10))).toThrow()
  })
})

describe('orderCorners', () => {
  it('returns TL, TR, BR, BL for any tap order', () => {
    const [tl, tr, br, bl] = quad
    for (const tapped of [[br, tl, bl, tr], [bl, br, tr, tl], [tr, bl, tl, br]]) {
      expect(orderCorners(tapped)).toEqual([tl, tr, br, bl])
    }
  })
})

describe('rectSize / validQuad', () => {
  it('uses the longer opposite edges and caps the size', () => {
    const { w, h } = rectSize(quad)
    expect(w).toBeGreaterThan(480); expect(h).toBeGreaterThan(250)
    const big = rectSize([{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 }, { x: 0, y: 4000 }], 1600)
    expect(Math.max(big.w, big.h)).toBe(1600)
  })
  it('accepts a normal quad and rejects bow-ties and slivers', () => {
    expect(validQuad(quad, 640, 360)).toBe(true)
    expect(validQuad([quad[0], quad[2], quad[1], quad[3]], 640, 360)).toBe(false) // crossed
    expect(validQuad([{ x: 0, y: 0 }, { x: 100, y: 1 }, { x: 100, y: 3 }, { x: 0, y: 2 }], 640, 360)).toBe(false)
  })
})

describe('warpRGBA', () => {
  it('straightens a perspective grid so a tilted square becomes a square', () => {
    // 640x360 source: white with a black filled quad
    const W = 640, H = 360, src = new Uint8ClampedArray(W * H * 4).fill(255)
    const inside = (x: number, y: number) => {
      // point-in-quad via the inverse homography
      const q = apply(homography(quad, rect(1, 1)), { x, y })
      return q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x, y)) { const o = (y * W + x) * 4; src[o] = src[o + 1] = src[o + 2] = 0 }
    const w = 200, h = 120
    const toSrc = invert(homography(quad, rect(w, h)))
    const out = warpRGBA(src, W, H, toSrc, w, h)
    let dark = 0
    for (let i = 0; i < w * h; i++) if (out[i * 4] < 128) dark++
    expect(dark / (w * h)).toBeGreaterThan(0.97) // the whole rectangle is the (formerly slanted) black quad
  })
  it('paints outside pixels mid-grey', () => {
    const out = warpRGBA(new Uint8ClampedArray(4 * 4 * 4).fill(0), 4, 4, [1, 0, 100, 0, 1, 100, 0, 0, 1], 2, 2)
    expect(out[0]).toBe(114)
  })
})
