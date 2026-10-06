import { describe, expect, it } from 'vitest'
import { autoContrast, countSimilar } from './exemplar'
import { discs, grid } from './testutil'

describe('countSimilar', () => {
  const centers = grid(6, 4)
  const g = discs(280, 190, centers)
  const box = { x: 30 - 16, y: 30 - 16, w: 32, h: 32 }

  it('counts every disc when the exemplar is one of them', () => {
    expect(countSimilar(g, box, { threshold: 0.6 })).toHaveLength(24)
  })

  it('places dots at the disc centres', () => {
    const dots = countSimilar(g, box, { threshold: 0.6 })
    for (const [cx, cy] of centers) {
      expect(dots.some(d => Math.hypot(d.x - cx, d.y - cy) < 4)).toBe(true)
    }
  })

  it('finds nothing in an empty photo', () => {
    expect(countSimilar(discs(280, 190, []), box, { threshold: 0.6 })).toHaveLength(0)
  })

  it('rejects boxes that run off the image or are tiny', () => {
    expect(countSimilar(g, { x: 270, y: 180, w: 32, h: 32 }, { threshold: 0.6 })).toEqual([])
    expect(countSimilar(g, { x: 10, y: 10, w: 2, h: 2 }, { threshold: 0.6 })).toEqual([])
  })

  it('still counts a dim photo once contrast is stretched', () => {
    const dim = autoContrast(discs(280, 190, centers, 14, 0.25))
    expect(countSimilar(dim, box, { threshold: 0.6 })).toHaveLength(24)
  })

  it('maps results back to full-size pixels when the working image is downscaled', () => {
    const half = { ...discs(140, 95, grid(6, 4, 20, 15), 7), scale: 2 }
    const dots = countSimilar(half, { x: 22, y: 22, w: 16, h: 16 }, { threshold: 0.6 })
    expect(dots).toHaveLength(24)
    expect(Math.max(...dots.map(d => d.x))).toBeGreaterThan(200)
  })
})

describe('autoContrast', () => {
  it('stretches a dim image toward the full range', () => {
    const out = autoContrast(discs(100, 100, [[50, 50]], 20, 0.25))
    expect(Math.max(...out.data)).toBeGreaterThan(200)
  })
})
