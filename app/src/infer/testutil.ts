import type { Gray } from './exemplar'

/** Dark background with `centers` bright-rimmed discs (like pipe ends); `gain` dims the whole image. */
export function discs(w: number, h: number, centers: [number, number][], r = 14, gain = 1): Gray {
  const data = new Float32Array(w * h).fill(60 * gain)
  for (const [cx, cy] of centers) {
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r + 1); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy)
        if (d <= r) data[y * w + x] = (d < r * 0.55 ? 25 : 200) * gain
      }
    }
  }
  return { data, w, h, scale: 1 }
}

export function grid(cols: number, rows: number, pitch = 40, off = 30): [number, number][] {
  const out: [number, number][] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push([off + i * pitch, off + j * pitch])
  return out
}
