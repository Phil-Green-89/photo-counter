// Tap-one counter, v0: normalised cross-correlation of an exemplar patch over the photo.
// Pure JS, no model download. The DINOv2 feature version replaces `correlate` (see plan, phase 0).

export interface Box { x: number; y: number; w: number; h: number }
export interface Dot { x: number; y: number }

const MAX_SIDE = 800
const MAX_TEMPLATE = 28

export interface Gray { data: Float32Array; w: number; h: number; scale: number }

/** Downscale to grayscale; `scale` maps working pixels back to the full-size image. */
export function toGray(img: CanvasImageSource, srcW: number, srcH: number): Gray {
  const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const data = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    data[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]
  }
  return { data, w, h, scale: 1 / scale }
}

/** Per-image contrast stretch (2nd–98th percentile). Helps dim photos. */
export function autoContrast(g: Gray): Gray {
  const hist = new Uint32Array(256)
  for (const v of g.data) hist[Math.max(0, Math.min(255, v | 0))]++
  const n = g.data.length
  let lo = 0, hi = 255, acc = 0
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break } }
  acc = 0
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break } }
  const range = Math.max(1, hi - lo)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, ((g.data[i] - lo) / range) * 255))
  return { ...g, data: out }
}

interface Params {
  /** 0..1 correlation threshold; lower finds more, riskier matches */
  threshold: number
}

/** Count items that look like the exemplar box (box is in full-size image pixels). */
export function countSimilar(g: Gray, box: Box, { threshold }: Params): Dot[] {
  const s = 1 / g.scale
  let tw = Math.round(box.w * s)
  let th = Math.round(box.h * s)
  let tx = Math.round(box.x * s)
  let ty = Math.round(box.y * s)
  // keep the template small enough to scan quickly
  const shrink = Math.min(1, MAX_TEMPLATE / Math.max(tw, th))
  let work = g
  if (shrink < 1) {
    work = resize(g, shrink)
    tw = Math.max(4, Math.round(tw * shrink)); th = Math.max(4, Math.round(th * shrink))
    tx = Math.round(tx * shrink); ty = Math.round(ty * shrink)
  }
  if (tw < 4 || th < 4 || tx < 0 || ty < 0 || tx + tw > work.w || ty + th > work.h) return []

  const t = new Float32Array(tw * th)
  let tMean = 0
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const v = work.data[(ty + y) * work.w + tx + x]
    t[y * tw + x] = v; tMean += v
  }
  tMean /= t.length
  let tNorm = 0
  for (let i = 0; i < t.length; i++) { t[i] -= tMean; tNorm += t[i] * t[i] }
  tNorm = Math.sqrt(tNorm)
  if (tNorm < 1e-3) return []

  // integral images for the window mean/variance
  const W = work.w, H = work.h
  const I = new Float64Array((W + 1) * (H + 1))
  const I2 = new Float64Array((W + 1) * (H + 1))
  for (let y = 0; y < H; y++) {
    let r = 0, r2 = 0
    for (let x = 0; x < W; x++) {
      const v = work.data[y * W + x]
      r += v; r2 += v * v
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + r
      I2[(y + 1) * (W + 1) + x + 1] = I2[y * (W + 1) + x + 1] + r2
    }
  }
  const win = (a: Float64Array, x: number, y: number) =>
    a[(y + th) * (W + 1) + x + tw] - a[y * (W + 1) + x + tw] - a[(y + th) * (W + 1) + x] + a[y * (W + 1) + x]

  const ow = W - tw + 1, oh = H - th + 1
  const score = new Float32Array(ow * oh)
  const n = tw * th
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const sum = win(I, x, y)
    const variance = win(I2, x, y) - (sum * sum) / n
    if (variance < 1e-3) continue
    let dot = 0
    for (let j = 0; j < th; j++) {
      const row = (y + j) * W + x
      const trow = j * tw
      for (let i = 0; i < tw; i++) dot += work.data[row + i] * t[trow + i]
    }
    score[y * ow + x] = dot / (tNorm * Math.sqrt(variance))
  }

  // greedy non-max suppression: best first, suppress anything within ~0.7 of the item size
  const cand: { x: number; y: number; s: number }[] = []
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const v = score[y * ow + x]
    if (v >= threshold) cand.push({ x, y, s: v })
  }
  cand.sort((a, b) => b.s - a.s)
  const minDx = tw * 0.7, minDy = th * 0.7
  const kept: { x: number; y: number }[] = []
  for (const c of cand) {
    if (kept.every(k => Math.abs(k.x - c.x) >= minDx || Math.abs(k.y - c.y) >= minDy)) kept.push(c)
  }
  const back = g.scale / shrink
  return kept.map(k => ({ x: (k.x + tw / 2) * back, y: (k.y + th / 2) * back }))
}

function resize(g: Gray, f: number): Gray {
  const w = Math.max(1, Math.round(g.w * f)), h = Math.max(1, Math.round(g.h * f))
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // box average of the source cells that map to this pixel
    const x0 = Math.floor(x / f), x1 = Math.min(g.w, Math.max(x0 + 1, Math.floor((x + 1) / f)))
    const y0 = Math.floor(y / f), y1 = Math.min(g.h, Math.max(y0 + 1, Math.floor((y + 1) / f)))
    let s = 0, c = 0
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g.data[yy * g.w + xx]; c++ }
    data[y * w + x] = s / c
  }
  return { data, w, h, scale: g.scale / f }
}
