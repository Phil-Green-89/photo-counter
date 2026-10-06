// Straighten a photo of a bundle taken at an angle: the user taps the four corners of the end face and we
// warp that quadrilateral to a rectangle (a homography), so every end has about the same size and shape.
// Pure maths on typed arrays, so it is unit-tested without a browser.

export interface Pt { x: number; y: number }
/** 3×3 matrix, row-major. */
export type Mat3 = number[]

/** Solve the 8 unknowns of the homography that maps each src[i] to dst[i] (4 point pairs). */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-10) throw new Error('degenerate corners')
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

export function apply(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }
}

export function invert(H: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = H
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('singular')
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det)
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Order four taps as top-left, top-right, bottom-right, bottom-left, whatever order they were tapped in. */
export function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4
  const sorted = [...pts].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx)) // clockwise from left in screen coords
  // start at the corner closest to the top-left of the bounding box
  const minX = Math.min(...pts.map(p => p.x)), minY = Math.min(...pts.map(p => p.y))
  let start = 0
  sorted.forEach((p, i) => { if (dist(p, { x: minX, y: minY }) < dist(sorted[start], { x: minX, y: minY })) start = i })
  return [0, 1, 2, 3].map(i => sorted[(start + i) % 4])
}

/** Output rectangle for a quad: long edges set the size, capped so the warp stays fast on phones. */
export function rectSize(q: Pt[], maxSide = 1600): { w: number; h: number } {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]))
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]))
  const s = Math.min(1, maxSide / Math.max(w, h))
  w = Math.max(8, Math.round(w * s)); h = Math.max(8, Math.round(h * s))
  return { w, h }
}

/** A quad worth warping: convex, not tiny, not folded over. */
export function validQuad(q: Pt[], imgW: number, imgH: number): boolean {
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
  const s = [0, 1, 2, 3].map(i => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])))
  const area = Math.abs(q.reduce((acc, p, i) => acc + (p.x * q[(i + 1) % 4].y - q[(i + 1) % 4].x * p.y), 0)) / 2
  return s.every(v => v === s[0] && v !== 0) && area > 0.02 * imgW * imgH
}

/**
 * Warp `src` (RGBA, srcW×srcH) into a w×h rectangle. `toSrc` maps output pixels to source pixels.
 * Bilinear sampling; pixels that fall outside the source are left mid-grey.
 */
export function warpRGBA(src: Uint8ClampedArray, srcW: number, srcH: number, toSrc: Mat3, w: number, h: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = apply(toSrc, { x: x + 0.5, y: y + 0.5 })
      const o = (y * w + x) * 4
      const sx = p.x - 0.5, sy = p.y - 0.5
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      if (x0 < 0 || y0 < 0 || x0 + 1 >= srcW || y0 + 1 >= srcH) { out[o] = out[o + 1] = out[o + 2] = 114; out[o + 3] = 255; continue }
      const fx = sx - x0, fy = sy - y0
      for (let c = 0; c < 3; c++) {
        const i = (y0 * srcW + x0) * 4 + c
        out[o + c] = (src[i] * (1 - fx) + src[i + 4] * fx) * (1 - fy) + (src[i + srcW * 4] * (1 - fx) + src[i + srcW * 4 + 4] * fx) * fy
      }
      out[o + 3] = 255
    }
  }
  return out
}
