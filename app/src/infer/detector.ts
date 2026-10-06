// Pipe/rebar end detector: YOLO-nano ONNX run with onnxruntime-web (wasm), fully on the phone.
// The model is optional. Without public/models/manifest.json the app falls back to tap-one counting.

import { detectAll, letterbox, decode, unletterbox, type Det, type Rect } from './yolo'

export interface Manifest {
  version: string
  /** model file next to the manifest */
  file: string
  inputSize: number
  numClasses: number
  conf: number
  iou: number
}

export interface Detection { dots: { x: number; y: number }[]; median: { w: number; h: number } }

type Ort = typeof import('onnxruntime-web/wasm')

const base = () => import.meta.env.BASE_URL
let loading: Promise<Loaded | null> | null = null

interface Loaded { manifest: Manifest; ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }

async function load(): Promise<Loaded | null> {
  try {
    const res = await fetch(`${base()}models/manifest.json`, { cache: 'no-cache' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    const manifest = (await res.json()) as Manifest
    const ort = await import('onnxruntime-web/wasm')
    ort.env.wasm.numThreads = 1 // multi-threading needs cross-origin isolation, which static hosts don't give
    const session = await ort.InferenceSession.create(`${base()}models/${manifest.file}`, { executionProviders: ['wasm'] })
    return { manifest, ort, session }
  } catch {
    return null
  }
}

/** Resolves to the loaded model, or null if none is installed (result is cached). */
export function loadDetector(): Promise<Loaded | null> {
  return (loading ??= load())
}

export async function detectorVersion(): Promise<string | null> {
  return (await loadDetector())?.manifest.version ?? null
}

/** Draw `crop` of the source into a letterboxed square and return an NCHW float tensor in 0..1. */
function toTensor(src: CanvasImageSource, crop: Rect, size: number) {
  const lb = letterbox(crop.w, crop.h, size)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, lb.padX, lb.padY, crop.w * lb.scale, crop.h * lb.scale)
  const px = ctx.getImageData(0, 0, size, size).data
  const plane = size * size
  const data = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    data[i] = px[i * 4] / 255
    data[plane + i] = px[i * 4 + 1] / 255
    data[2 * plane + i] = px[i * 4 + 2] / 255
  }
  return { data, lb }
}

/** Count items in the photo. Returns null when no model is installed. */
export async function detect(src: CanvasImageSource, W: number, H: number): Promise<Detection | null> {
  const m = await loadDetector()
  if (!m) return null
  const { manifest: mf, ort, session } = m

  const run = async (crop: Rect): Promise<Det[]> => {
    const { data, lb } = toTensor(src, crop, mf.inputSize)
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, mf.inputSize, mf.inputSize]) })
    const t = out[session.outputNames[0]]
    const n = t.dims[2]
    return unletterbox(decode(t.data as Float32Array, n, mf.numClasses, mf.conf), lb, crop)
  }

  const dets = await detectAll(W, H, run, { iou: mf.iou, inputSize: mf.inputSize })
  const sides = (f: (d: Det) => number) => {
    const s = dets.map(f).sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  }
  return {
    dots: dets.map(d => ({ x: d.x, y: d.y })),
    median: { w: sides(d => d.w), h: sides(d => d.h) },
  }
}
