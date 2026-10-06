// Model-agnostic YOLO helpers: decode the raw head, non-max suppression, and the scale policy
// (global pass first, tiled pass when items are tiny). Pure functions, no ORT/DOM, so they are unit-tested.

export interface Det { x: number; y: number; w: number; h: number; score: number } // centre-based
export interface Rect { x: number; y: number; w: number; h: number }

/** Raw head of YOLOv8/11 exported without NMS: channel-major [4+nc, n]; boxes are cx,cy,w,h in input pixels. */
export function decode(out: ArrayLike<number>, n: number, nc: number, conf: number): Det[] {
  const dets: Det[] = []
  for (let i = 0; i < n; i++) {
    let best = 0
    for (let c = 0; c < nc; c++) best = Math.max(best, out[(4 + c) * n + i])
    if (best >= conf) dets.push({ x: out[i], y: out[n + i], w: out[2 * n + i], h: out[3 * n + i], score: best })
  }
  return dets
}

export function iou(a: Det, b: Det): number {
  const ix = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
  const iy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2)
  if (ix <= 0 || iy <= 0) return 0
  const inter = ix * iy
  return inter / (a.w * a.h + b.w * b.h - inter)
}

export function nms(dets: Det[], iouThresh: number): Det[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score)
  const kept: Det[] = []
  for (const d of sorted) if (kept.every(k => iou(k, d) < iouThresh)) kept.push(d)
  return kept
}

export interface Letterbox { scale: number; padX: number; padY: number }

export function letterbox(w: number, h: number, size: number): Letterbox {
  const scale = size / Math.max(w, h)
  return { scale, padX: (size - w * scale) / 2, padY: (size - h * scale) / 2 }
}

/** Map detections from model-input pixels back into the cropped region's image coordinates. */
export function unletterbox(dets: Det[], lb: Letterbox, crop: Rect): Det[] {
  return dets.map(d => ({
    x: (d.x - lb.padX) / lb.scale + crop.x, y: (d.y - lb.padY) / lb.scale + crop.y,
    w: d.w / lb.scale, h: d.h / lb.scale, score: d.score,
  }))
}

/** grid×grid overlapping crops covering the image. */
export function tilesFor(W: number, H: number, grid: number, overlap = 0.2): Rect[] {
  const tw = W / (grid - (grid - 1) * overlap)
  const th = H / (grid - (grid - 1) * overlap)
  const out: Rect[] = []
  for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
    out.push({
      x: grid === 1 ? 0 : (i * (W - tw)) / (grid - 1),
      y: grid === 1 ? 0 : (j * (H - th)) / (grid - 1),
      w: tw, h: th,
    })
  }
  return out
}

/** A box cut by an interior tile edge is a fragment; its neighbour tile sees the whole item. */
function clippedByInteriorEdge(d: Det, t: Rect, W: number, H: number): boolean {
  const m = 0.01 * Math.max(t.w, t.h)
  const l = d.x - d.w / 2, r = d.x + d.w / 2, u = d.y - d.h / 2, b = d.y + d.h / 2
  return (l <= t.x + m && t.x > m) || (r >= t.x + t.w - m && t.x + t.w < W - m) ||
         (u <= t.y + m && t.y > m) || (b >= t.y + t.h - m && t.y + t.h < H - m)
}

export function medianSide(dets: Det[]): number {
  if (!dets.length) return 0
  const s = dets.map(d => (d.w + d.h) / 2).sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Runs the model on one crop and returns detections in full-image coordinates. */
export type TileRunner = (crop: Rect) => Promise<Det[]>

export interface DetectOptions {
  iou: number
  /** model input size; items smaller than `tinyPx` at that size trigger the tiled pass */
  inputSize: number
  tinyPx?: number
}

/**
 * Global pass first. Pipe ends in a big bundle shrink to a few pixels at 640, so when the median
 * item is tiny, re-run on 2×2 (or 3×3) zoomed tiles and use that result instead.
 */
export async function detectAll(W: number, H: number, run: TileRunner, o: DetectOptions): Promise<Det[]> {
  const tiny = o.tinyPx ?? 22
  const toInput = o.inputSize / Math.max(W, H)
  const global = nms(await run({ x: 0, y: 0, w: W, h: H }), o.iou)
  const med = medianSide(global) * toInput
  if (global.length > 0 && med >= tiny) return global

  const grid = med < tiny / 2 ? 3 : 2
  const all: Det[] = []
  for (const t of tilesFor(W, H, grid)) {
    const found = await run(t)
    all.push(...found.filter(d => !clippedByInteriorEdge(d, t, W, H)))
  }
  const merged = nms(all, o.iou)
  // never return fewer than the global pass found: a bad tiling must not lose items
  return merged.length >= global.length ? merged : global
}
