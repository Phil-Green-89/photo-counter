// Find places inside a bundle where an end is "missing": an empty spot completely surrounded by ends.
// Either that tube is pushed back into the bundle (a hidden length that still counts) or the bundle really has a gap.
// Only the person at the bundle can tell, so we flag these and let them confirm.
// Works on a straightened view, where neighbouring ends sit about one spacing apart.

export interface P { x: number; y: number }

/** Typical centre-to-centre spacing: median nearest-neighbour distance. */
export function spacing(dots: P[]): number {
  if (dots.length < 2) return 0
  const cell = estimateCell(dots)
  const grid = bucket(dots, cell)
  const nn = dots.map((d, i) => {
    let best = Infinity
    for (const j of near(grid, cell, d, 2)) if (j !== i) best = Math.min(best, Math.hypot(dots[j].x - d.x, dots[j].y - d.y))
    return best
  }).filter(Number.isFinite).sort((a, b) => a - b)
  return nn.length ? nn[Math.floor(nn.length / 2)] : 0
}

function estimateCell(dots: P[]): number {
  const xs = dots.map(d => d.x), ys = dots.map(d => d.y)
  const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1)
  return Math.max(4, Math.sqrt(area / dots.length) * 1.2)
}

function bucket(dots: P[], cell: number) {
  const m = new Map<string, number[]>()
  dots.forEach((d, i) => {
    const k = `${Math.floor(d.x / cell)},${Math.floor(d.y / cell)}`
    ;(m.get(k) ?? m.set(k, []).get(k)!).push(i)
  })
  return m
}

function* near(grid: Map<string, number[]>, cell: number, p: P, rings: number) {
  const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell)
  for (let dy = -rings; dy <= rings; dy++) for (let dx = -rings; dx <= rings; dx++) yield* grid.get(`${cx + dx},${cy + dy}`) ?? []
}

export interface GapOptions {
  /** how many of the 12 surrounding directions must have an end (hex = 6 neighbours, square = 4/8) */
  minSurround?: number
}

/**
 * An empty spot is a gap when no end sits within ~0.75 spacing of it, but ends surround it on (nearly) all sides.
 * Edges of the bundle never qualify because one side of them is open.
 */
export function findGaps(dots: P[], opts: GapOptions = {}): P[] {
  if (dots.length < 12) return []
  const d = spacing(dots)
  if (d < 6) return []
  const minSurround = opts.minSurround ?? 11
  const cell = d
  const grid = bucket(dots, cell)
  const xs = dots.map(p => p.x), ys = dots.map(p => p.y)
  const step = d / 3
  const hasDot = (p: P, r: number) => {
    for (const j of near(grid, cell, p, 1)) if (Math.hypot(dots[j].x - p.x, dots[j].y - p.y) < r) return true
    return false
  }
  const cands: { p: P; room: number }[] = []
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      const p = { x, y }
      if (hasDot(p, 0.75 * d)) continue
      let around = 0
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2
        if (hasDot({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d }, 0.55 * d)) around++
      }
      if (around < minSurround) continue
      let room = Infinity
      for (const j of near(grid, cell, p, 1)) room = Math.min(room, Math.hypot(dots[j].x - x, dots[j].y - y))
      cands.push({ p, room })
    }
  }
  // the emptiest spot first; drop candidates that are just the same hole seen from a neighbouring grid point
  cands.sort((a, b) => b.room - a.room)
  const out: P[] = []
  for (const c of cands) if (out.every(o => Math.hypot(o.x - c.p.x, o.y - c.p.y) > 0.9 * d)) out.push(c.p)
  return out
}
