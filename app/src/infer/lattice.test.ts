import { describe, expect, it } from 'vitest'
import { findGaps, spacing, type P } from './lattice'

function hex(cols: number, rows: number, d = 30, jitter = 0, seed = 1): P[] {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5)
  const out: P[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    out.push({ x: 50 + i * d + (j % 2) * d / 2 + rnd() * jitter * d, y: 50 + j * d * 0.866 + rnd() * jitter * d })
  }
  return out
}
const square = (cols: number, rows: number, d = 30): P[] => {
  const out: P[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: 50 + i * d, y: 50 + j * d })
  return out
}
const without = (dots: P[], idx: number[]) => dots.filter((_, i) => !idx.includes(i))
const idx = (cols: number, i: number, j: number) => j * cols + i

describe('spacing', () => {
  it('finds the lattice pitch', () => {
    expect(spacing(hex(10, 8, 30))).toBeCloseTo(30, 0)
  })
})

describe('findGaps', () => {
  it('finds nothing in a complete bundle', () => {
    expect(findGaps(hex(12, 10))).toEqual([])
    expect(findGaps(square(10, 8))).toEqual([])
  })

  it('flags each missing end that is surrounded on all sides (hex)', () => {
    const all = hex(12, 10)
    const holes = [idx(12, 5, 4), idx(12, 8, 6), idx(12, 3, 7)]
    const gaps = findGaps(without(all, holes))
    expect(gaps).toHaveLength(3)
    for (const h of holes) expect(gaps.some(g => Math.hypot(g.x - all[h].x, g.y - all[h].y) < 8)).toBe(true)
  })

  it('flags gaps in a square-packed bundle', () => {
    const all = square(10, 8)
    const hole = idx(10, 4, 3)
    const gaps = findGaps(without(all, [hole]))
    expect(gaps).toHaveLength(1)
    expect(Math.hypot(gaps[0].x - all[hole].x, gaps[0].y - all[hole].y)).toBeLessThan(8)
  })

  it('still finds them when the ends are not perfectly placed', () => {
    const all = hex(12, 10, 30, 0.12, 3)
    const hole = idx(12, 6, 5)
    const gaps = findGaps(without(all, [hole]))
    expect(gaps.length).toBeGreaterThanOrEqual(1)
    expect(gaps.some(g => Math.hypot(g.x - all[hole].x, g.y - all[hole].y) < 12)).toBe(true)
  })

  it('does not flag missing ends on the edge of the bundle or the open corners', () => {
    const all = hex(12, 10)
    const edge = [idx(12, 0, 4), idx(12, 11, 5), idx(12, 5, 0), idx(12, 6, 9)]
    expect(findGaps(without(all, edge))).toEqual([])
  })

  it('does not call a ragged outline a gap (stepped top edge)', () => {
    const all = hex(12, 10).filter(p => !(p.x < 150 && p.y < 120))
    expect(findGaps(all)).toEqual([])
  })

  it('needs enough ends to judge', () => {
    expect(findGaps(hex(3, 3))).toEqual([])
  })
})
