import { useEffect, useRef, useState } from 'preact/hooks'
import type { Box, Dot } from '../infer/exemplar'
import { Icon } from './icons'

interface Props {
  src: string
  imgW: number
  imgH: number
  mode: 'pick' | 'edit' | 'corners'
  dots: Dot[]
  box: Box | null
  onBox: (b: Box) => void
  /** pick mode: a plain tap (no drag) on an item */
  onTap?: (d: Dot) => void
  onAdd: (d: Dot) => void
  onRemove: (i: number) => void
  /** spots that might hold a hidden end; shown as amber "?" rings */
  gaps?: Dot[]
  onGap?: (i: number) => void
  /** the corner taps for straightening, drawn as numbered handles joined by a line */
  corners?: Dot[]
  /** centre and zoom in on a point; change `n` to trigger again */
  focus?: { x: number; y: number; n: number } | null
  /** space reserved for the overlays above/below, so the photo is never hidden under them */
  insetTop?: number
  insetBottom?: number
}

interface View { k: number; tx: number; ty: number }
const TAP_SLOP = 8

/** Photo with pinch/drag zoom, +/- buttons, and tap-to-edit dots (constant on-screen size). */
export function Viewer(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 })
  const [fitK, setFitK] = useState(1)
  const [draft, setDraftState] = useState<Box | null>(null)
  const draftRef = useRef<Box | null>(null)
  const setDraft = (b: Box | null) => { draftRef.current = b; setDraftState(b) }
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ start: { x: number; y: number }; moved: boolean; view: View; dist?: number; mid?: { x: number; y: number } } | null>(null)

  // fit image to the host on load / resize
  useEffect(() => {
    const fit = () => {
      const r = host.current!.getBoundingClientRect()
      if (!r.width || !r.height) return
      const top = p.insetTop ?? 0, bottom = p.insetBottom ?? 0
      const availH = Math.max(80, r.height - top - bottom)
      const k = Math.min(r.width / p.imgW, availH / p.imgH)
      setFitK(k)
      setView({ k, tx: (r.width - p.imgW * k) / 2, ty: top + (availH - p.imgH * k) / 2 })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [p.src, p.imgW, p.imgH, p.insetTop, p.insetBottom])

  // jump to a point (used to walk the user through spots that need a visual check)
  useEffect(() => {
    if (!p.focus) return
    const r = host.current!.getBoundingClientRect()
    const k = Math.max(view.k, fitK * 3.2)
    const top = p.insetTop ?? 0, bottom = p.insetBottom ?? 0
    setView({ k, tx: r.width / 2 - p.focus.x * k, ty: top + (r.height - top - bottom) / 2 - p.focus.y * k })
  }, [p.focus?.n])

  const toImg = (cx: number, cy: number, v = view) => {
    const r = host.current!.getBoundingClientRect()
    return { x: (cx - r.left - v.tx) / v.k, y: (cy - r.top - v.ty) / v.k }
  }

  const zoomAt = (v: View, cx: number, cy: number, nk: number): View => {
    const k = Math.max(fitK * 0.9, Math.min(fitK * 12, nk))
    const r = host.current!.getBoundingClientRect()
    const px = cx - r.left, py = cy - r.top
    return { k, tx: px - ((px - v.tx) / v.k) * k, ty: py - ((py - v.ty) / v.k) * k }
  }

  const zoomButton = (f: number) => {
    const r = host.current!.getBoundingClientRect()
    setView(v => zoomAt(v, r.left + r.width / 2, r.top + r.height / 2, v.k * f))
  }

  const down = (e: PointerEvent) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 1) {
      gesture.current = { start: { x: e.clientX, y: e.clientY }, moved: false, view }
      if (p.mode === 'pick') {
        const s = toImg(e.clientX, e.clientY)
        setDraft({ x: s.x, y: s.y, w: 0, h: 0 })
      }
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      gesture.current = {
        start: { x: e.clientX, y: e.clientY }, moved: true, view,
        dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      }
      setDraft(null)
    }
  }

  const move = (e: PointerEvent) => {
    const g = gesture.current
    if (!g || !ptrs.current.has(e.pointerId)) return
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size >= 2 && g.dist && g.mid) {
      const [a, b] = [...ptrs.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const z = zoomAt(g.view, g.mid.x, g.mid.y, g.view.k * (d / g.dist))
      setView({ ...z, tx: z.tx + (mid.x - g.mid.x), ty: z.ty + (mid.y - g.mid.y) })
      return
    }
    const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y
    if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true
    if (!g.moved) return
    if (p.mode === 'pick') {
      const s = toImg(g.start.x, g.start.y), c = toImg(e.clientX, e.clientY)
      setDraft({ x: Math.min(s.x, c.x), y: Math.min(s.y, c.y), w: Math.abs(c.x - s.x), h: Math.abs(c.y - s.y) })
    } else {
      setView({ ...g.view, tx: g.view.tx + dx, ty: g.view.ty + dy })
    }
  }

  const up = (e: PointerEvent) => {
    const g = gesture.current
    ptrs.current.delete(e.pointerId)
    if (!g) return
    if (ptrs.current.size === 0) {
      const d = draftRef.current
      if (p.mode === 'pick' && d && d.w > 6 && d.h > 6) p.onBox(d)
      else if (p.mode === 'pick' && !g.moved) p.onTap?.(toImg(e.clientX, e.clientY))
      else if (p.mode === 'edit' && !g.moved) p.onAdd(toImg(e.clientX, e.clientY))
      else if (p.mode === 'corners' && !g.moved) p.onTap?.(toImg(e.clientX, e.clientY))
      setDraft(null)
      gesture.current = null
    } else {
      // dropped from two fingers to one: restart the pan from here
      const [rest] = [...ptrs.current.values()]
      gesture.current = { start: rest, moved: true, view }
    }
  }

  const dblClick = (e: MouseEvent) => {
    if (p.mode !== 'edit') return
    e.preventDefault()
    setView(v => zoomAt(v, e.clientX, e.clientY, v.k * 2))
  }

  // dense photos get smaller hit targets; numbers appear once you are zoomed in enough to read them
  const dotPx = p.dots.length > 120 ? 24 : 34
  const showNum = view.k > fitK * 2.2 && p.dots.length <= 400
  const shown = draft ?? p.box
  return (
    <div class={`viewer ${p.mode}`} ref={host}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDblClick={dblClick}>
      <div class="inner" style={{ width: p.imgW, height: p.imgH, transform: `translate(${view.tx}px,${view.ty}px) scale(${view.k})` }}>
        <img src={p.src} width={p.imgW} height={p.imgH} draggable={false} />
        {shown && (
          <div class="box" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h, borderWidth: 3 / view.k, borderRadius: 6 / view.k }} />
        )}
        {p.corners && p.corners.length > 0 && (
          <svg class="poly" width={p.imgW} height={p.imgH} aria-hidden="true">
            <polyline points={[...p.corners, ...(p.corners.length === 4 ? [p.corners[0]] : [])].map(c => `${c.x},${c.y}`).join(' ')}
              fill={p.corners.length === 4 ? 'rgba(255,200,0,.12)' : 'none'} stroke="#ffc800" stroke-width="3" vector-effect="non-scaling-stroke" />
          </svg>
        )}
        {p.corners?.map((c, i) => (
          <div key={'c' + i} class="corner" style={{ left: c.x, top: c.y, transform: `translate(-50%,-50%) scale(${1 / view.k})` }}>{i + 1}</div>
        ))}
        {p.gaps?.map((g, i) => (
          <button key={'g' + i} class="gap" aria-label={`Check spot ${i + 1}`}
            style={{ left: g.x, top: g.y, width: 40, height: 40, transform: `translate(-50%,-50%) scale(${1 / view.k})` }}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); p.onGap?.(i) }}>
            <span class="q">?</span>
          </button>
        ))}
        {p.dots.map((d, i) => (
          <button key={i} class="dot" aria-label={`Remove ${i + 1}`}
            style={{ left: d.x, top: d.y, width: dotPx, height: dotPx, transform: `translate(-50%,-50%) scale(${1 / view.k})` }}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); p.onRemove(i) }}>
            <span class="ring" style={{ minWidth: dotPx * 0.62, height: dotPx * 0.62 }}>{showNum && <i>{i + 1}</i>}</span>
          </button>
        ))}
      </div>
      <div class="zoom">
        <button aria-label="Zoom in" onPointerDown={e => e.stopPropagation()} onClick={() => zoomButton(1.6)}><Icon name="plus" /></button>
        <button aria-label="Zoom out" onPointerDown={e => e.stopPropagation()} onClick={() => zoomButton(1 / 1.6)}><Icon name="minus" /></button>
      </div>
    </div>
  )
}
