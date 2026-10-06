import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Viewer } from './ui/Viewer'
import { Icon, ItemIcon, Logo } from './ui/icons'
import { autoContrast, countSimilar, estimateItemBox, holeAspect, toGray, type Box, type Dot, type Gray } from './infer/exemplar'
import { lightingScore, type Lighting } from './infer/lighting'
import { detect, detectorVersion, loadDetector } from './infer/detector'
import { apply, homography, invert, orderCorners, rectSize, validQuad, warpRGBA, type Mat3 } from './infer/geometry'
import { findGaps, spacing } from './infer/lattice'
import {
  bumpUse, getConsent, orderedItems, pendingCount, saveFeedback, setConsent, updateFeedback,
  type FeedbackRecord, type ItemId,
} from './feedback/store'
import { syncConfig, syncPending } from './feedback/sync'
import './app.css'

type Step = 'home' | 'pick' | 'edit' | 'corners'
/** A photo straightened so every end is about the same size: H maps photo -> straight view, Hi maps back. */
interface Warp { H: Mat3; Hi: Mat3; w: number; h: number; url: string; quad: Dot[]; stretch: number; fixed: boolean }
const TAP_ONE_VERSION = 'ncc-v0'
/** Items the end-on circle detector was trained for; everything else uses tap-one. */
const DETECTOR_ITEMS: ItemId[] = ['pipes', 'rebar']

export function App() {
  const items = orderedItems()
  const [item, setItem] = useState<ItemId>(items[0].id)
  const [step, setStep] = useState<Step>('home')
  const [src, setSrc] = useState('')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [box, setBox] = useState<Box | null>(null)
  const [dots, setDots] = useState<Dot[]>([])
  const [light, setLight] = useState<Lighting | null>(null)
  const [thumb, setThumb] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(false)
  const [consent, setConsentState] = useState(getConsent())
  const [pending, setPending] = useState(0)
  const file = useRef<File | null>(null)
  const gray = useRef<Gray | null>(null)
  const modelDots = useRef<Dot[]>([])
  const undo = useRef<Dot[][]>([])
  const record = useRef<FeedbackRecord | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const modelVersion = useRef(TAP_ONE_VERSION)
  const photo = useRef<HTMLImageElement | null>(null)
  const [missed, setMissed] = useState(false)
  const canShare = syncConfig() !== null
  const [toast, setToast] = useState('')
  /** counts of earlier photos in this job; the total is their sum plus the photo on screen */
  const [session, setSession] = useState<number[]>([])
  const pendingAdd = useRef<number | null>(null)
  const [coach, setCoach] = useState(() => { try { return localStorage.getItem('pc.coach') !== '1' } catch { return true } })
  const usual = items[0]
  const [warp, setWarp] = useState<Warp | null>(null)
  const [corners, setCorners] = useState<Dot[]>([])
  const [tab, setTab] = useState<'photo' | 'straight'>('straight')
  const [dismissed, setDismissed] = useState<Dot[]>([])
  const [activeGap, setActiveGap] = useState<number | null>(null)
  const [walking, setWalking] = useState(false)
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null)
  const origGray = useRef<Gray | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 1800) }
  const dismissCoach = () => { setCoach(false); try { localStorage.setItem('pc.coach', '1') } catch { /* ignore */ } }

  const refreshPending = () => pendingCount().then(setPending)
  const sync = () => syncPending().then(refreshPending)

  useEffect(() => {
    refreshPending()
    sync()
    loadDetector() // warm the model in the background so the first count is quick
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])

  const onFile = (e: Event) => {
    const target = e.target as HTMLInputElement
    const f = target.files?.[0]
    target.value = ''
    if (!f) return
    leave()
    setError('')
    file.current = f
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onerror = () => { URL.revokeObjectURL(url); setError('bad photo') }
    img.onload = () => {
      const raw = toGray(img, img.naturalWidth, img.naturalHeight)
      setLight(lightingScore(raw))
      gray.current = autoContrast(raw)
      origGray.current = gray.current
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      if (src) URL.revokeObjectURL(src)
      photo.current = img
      if (pendingAdd.current !== null) { const n = pendingAdd.current; pendingAdd.current = null; setSession(s => [...s, n]) }
      setSrc(url); setBox(null); setDots([]); setThumb(null); setMissed(false)
      setWarp(null); setCorners([]); setDismissed([]); setActiveGap(null); setWalking(false); setTab('straight')
      undo.current = []; record.current = null
      modelVersion.current = TAP_ONE_VERSION
      setStep('pick')
      if (DETECTOR_ITEMS.includes(item)) autoCount(img)
    }
    img.src = url
  }

  /** Pipes/rebar: the trained detector counts straight away. If it is absent or finds nothing, the user draws a box. */
  const autoCount = async (img: HTMLImageElement) => {
    setBusy(true)
    try {
      const version = await detectorVersion()
      const res = version ? await detect(img, img.naturalWidth, img.naturalHeight) : null
      if (res && res.dots.length > 0) {
        const { w, h } = res.median
        modelVersion.current = version!
        modelDots.current = res.dots
        setBox({ x: res.dots[0].x - w / 2, y: res.dots[0].y - h / 2, w, h })
        setDots(res.dots); setStep('edit'); bumpUse(item)
      } else if (version) setMissed(true)
    } catch {
      setMissed(true)
    } finally { setBusy(false) }
  }

  /** Tap one item: work out its size from the photo, then count like it. */
  const tapOne = (d: Dot) => {
    setBusy(true)
    setTimeout(async () => {
      let p = d
      try { p = await roundOut(d) } catch { /* keep the tap as is */ }
      const b = estimateItemBox(gray.current!, p)
      setBusy(false)
      if (b) { setMissed(false); run(b) } else setMissed(true)
    }, 30)
  }

  const run = (b: Box) => {
    setBox(b); setBusy(true)
    // let the busy state paint before the synchronous scan
    setTimeout(() => {
      const found = countSimilar(gray.current!, b, { threshold: 0.6 })
      modelDots.current = found
      setDots(found); setBusy(false); setStep('edit')
      bumpUse(item)
    }, 30)
  }

  const edit = (next: Dot[]) => { undo.current.push(dots); setDots(next) }

  /** Create or update this photo's feedback record with the current dots and 👍/👎. */
  const persist = async (up: boolean | null, finalDots: Dot[] = dots) => {
    if (!file.current || !box || !light) return
    // training data is always in the ORIGINAL photo's pixels, even when the user counted on the straightened view
    const toOrig = (p: Dot) => (warp ? apply(warp.Hi, p) : p)
    const corners4 = [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }].map(toOrig)
    const ex = { x: Math.min(...corners4.map(c => c.x)), y: Math.min(...corners4.map(c => c.y)), w: 0, h: 0 }
    ex.w = Math.max(...corners4.map(c => c.x)) - ex.x; ex.h = Math.max(...corners4.map(c => c.y)) - ex.y
    const rec: FeedbackRecord = {
      ...(record.current ?? {}), at: record.current?.at ?? Date.now(), item, image: file.current,
      imgW: size.w, imgH: size.h, exemplar: ex, modelDots: modelDots.current.map(toOrig), finalDots: finalDots.map(toOrig),
      thumbsUp: up, lighting: light, modelVersion: modelVersion.current, uploaded: 0,
    }
    if (record.current?.id !== undefined) await updateFeedback(rec)
    else rec.id = (await saveFeedback(rec)) ?? undefined
    record.current = rec
    refreshPending()
  }

  const rate = (up: boolean) => { setThumb(up); flash(up ? 'Saved' : 'Thanks, we will learn from this'); persist(up).then(maybeAsk) }

  /** Leaving a counted photo keeps the final dots even if the user never pressed 👍/👎. */
  const leave = (): Promise<void> => (step === 'edit' ? persist(thumb) : Promise.resolve())

  const maybeAsk = () => {
    if (canShare && getConsent() === null) setAsking(true)
    else sync()
  }

  const answer = (yes: boolean) => {
    setConsent(yes); setConsentState(yes); setAsking(false)
    if (yes) sync()
  }

  const share = async () => {
    const c = document.createElement('canvas')
    const img = document.querySelector('.viewer img') as HTMLImageElement
    c.width = vW; c.height = vH
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const r = Math.max(10, vW / 90)
    ctx.font = `bold ${r * 1.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    vDots.forEach((d, i) => {
      ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), d.x, d.y)
    })
    const bar = vH / 8
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, vW, bar)
    ctx.fillStyle = '#fff'; ctx.font = `bold ${bar * 0.6}px sans-serif`; ctx.textAlign = 'left'
    ctx.fillText(`${dots.length}  ${item}`, bar * 0.3, bar / 2)
    const blob: Blob = await new Promise(r2 => c.toBlob(b => r2(b!), 'image/jpeg', 0.9))
    const f = new File([blob], `count-${dots.length}.jpg`, { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f], text: `${dots.length} ${item}` }).catch(() => {})
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click() }
  }

  // ---- straighten + hidden-end checks ----
  const straight = !!warp && (tab === 'straight' || step !== 'edit')
  const vSrc = warp && straight ? warp.url : src
  const vW = warp && straight ? warp.w : size.w
  const vH = warp && straight ? warp.h : size.h
  const toView = (p: Dot) => (warp && !straight ? apply(warp.Hi, p) : p)
  const fromView = (p: Dot) => (warp && !straight ? apply(warp.H, p) : p)

  /** Empty spots completely surrounded by ends: a tube pushed back, or a real gap. Only the user can tell. */
  const gaps = useMemo(() => {
    if (!warp || step !== 'edit') return []
    const d = spacing(dots)
    return findGaps(dots).filter(g => dismissed.every(x => Math.hypot(x.x - g.x, x.y - g.y) > 0.6 * d))
  }, [dots, dismissed, warp, step])
  const vDots = dots.map(toView)
  const vGaps = gaps.map(toView)

  const openGap = (i: number) => {
    const g = gaps[i]
    if (!g) return
    setActiveGap(i)
    const v = toView(g)
    setFocus({ x: v.x, y: v.y, n: Date.now() })
  }
  const resolveGap = (isThere: boolean) => {
    const g = gaps[activeGap!]
    if (!g) return
    if (isThere) edit([...dots, g]); else setDismissed(d => [...d, g])
    setActiveGap(null); setWalking(true) // carry on to the next spot, if any
  }
  useEffect(() => {
    if (!walking) return
    if (gaps.length > 0) openGap(0)
    else { setWalking(false); setActiveGap(null); flash('All spots checked') }
  }, [gaps, walking])

  const startStraighten = () => { setCorners([]); setActiveGap(null); setStep('corners') }
  const addCorner = (d: Dot) => {
    const next = [...corners, d]
    setCorners(next)
    if (next.length === 4) buildWarp(next)
  }
  /** Render the straightened view of `q` (ordered corners). `stretch` > 1 makes it taller, to round out squashed ends. */
  const renderWarp = async (q: Dot[], stretch: number): Promise<{ warp: Warp; gray: Gray }> => {
    const img = photo.current!
    const s = Math.min(1, 2400 / Math.max(size.w, size.h)) // warp from a reduced copy so big photos stay quick
    const c0 = document.createElement('canvas')
    c0.width = Math.round(size.w * s); c0.height = Math.round(size.h * s)
    const x0 = c0.getContext('2d', { willReadFrequently: true })!
    x0.drawImage(img, 0, 0, c0.width, c0.height)
    const qs = q.map(p => ({ x: p.x * s, y: p.y * s }))
    const base = rectSize(qs)
    const w = base.w, h = Math.min(2400, Math.max(8, Math.round(base.h * stretch)))
    const rect = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
    const out = warpRGBA(x0.getImageData(0, 0, c0.width, c0.height).data, c0.width, c0.height, invert(homography(qs, rect)), w, h)
    const c1 = document.createElement('canvas')
    c1.width = w; c1.height = h
    c1.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0)
    const blob: Blob = await new Promise((res, rej) => c1.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.92))
    const H = homography(q, rect) // photo pixels -> straight view (same rectangle)
    return { warp: { H, Hi: invert(H), w, h, url: URL.createObjectURL(blob), quad: q, stretch, fixed: false }, gray: autoContrast(toGray(c1, w, h)) }
  }

  const buildWarp = (pts: Dot[]) => {
    setBusy(true)
    setTimeout(async () => {
      try {
        const q = orderCorners(pts)
        if (!validQuad(q, size.w, size.h)) { flash("Those corners don't make a box. Try again"); setCorners([]); return }
        const r = await renderWarp(q, 1)
        gray.current = r.gray
        setWarp(r.warp)
        setTab('straight'); setBox(null); setDots([]); setDismissed([]); setMissed(false); undo.current = []; record.current = null
        setStep('pick')
      } catch { flash('Could not straighten that. Try again'); setCorners([]) } finally { setBusy(false) }
    }, 30)
  }

  /** First tap on a straightened view: if the ends look squashed, stretch the view until they are round, then size/count. */
  const roundOut = async (d: Dot): Promise<Dot> => {
    if (!warp || warp.fixed) return d
    const a = holeAspect(gray.current!, d)
    if (!a || (a > 0.88 && a < 1.14)) { setWarp({ ...warp, fixed: true }); return d }
    const stretch = Math.min(4, Math.max(0.25, warp.stretch / a))
    const r = await renderWarp(warp.quad, stretch)
    gray.current = r.gray
    setWarp({ ...r.warp, fixed: true })
    return { x: d.x, y: d.y * (stretch / warp.stretch) }
  }
  const clearWarp = () => {
    setWarp(null); setBox(null); setDots([]); setDismissed([]); setActiveGap(null); undo.current = []; record.current = null
    gray.current = origGray.current
    setStep('pick')
  }

  const goHome = () => { setStep('home'); setSession([]); pendingAdd.current = null; leave().then(maybeAsk) }

  /** Keep this photo's count and shoot another; the total keeps adding up. */
  const addAnother = () => {
    pendingAdd.current = dots.length
    flash('Keep photos from overlapping')
    leave().then(camera)
  }
  const camera = () => input.current?.click()
  const cur = items.find(i => i.id === item)!
  const rest = items.filter(i => i.id !== usual.id)
  const one = cur.label.toLowerCase().replace(/s$/, '')
  const darkChip = light && light.bucket !== 'good' ? (light.bucket === 'poor' ? 'Dark' : 'Dim') : null

  return (
    <div class="app">
      <input ref={input} data-testid="camera" type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {step === 'home' && (
        <div class="home">
          <header class="top-bar">
            <div class="brand"><Logo /><span>Counter</span></div>
            {canShare && (
              <button class={`cloud ${consent ? 'on' : ''}`} aria-label="Share photos to improve counting"
                onClick={() => answer(!consent)}>
                <Icon name={consent ? 'cloud' : 'lock'} size={22} />
                {consent && pending > 0 && <small>{pending}</small>}
              </button>
            )}
          </header>

          <div class="cards">
            <button class={`tile usual ${usual.id === item ? 'on' : ''}`} onClick={() => setItem(usual.id)}>
              <span class="art"><ItemIcon id={usual.id} size={76} /></span>
              <span class="name">{usual.label}</span>
              <span class="tag">Your usual</span>
              {usual.id === item && <span class="tick"><Icon name="check" size={18} /></span>}
            </button>
            {rest.map(i => (
              <button key={i.id} class={`tile ${i.id === item ? 'on' : ''} ${i.id === 'other' ? 'wide' : ''}`} onClick={() => setItem(i.id)}>
                <span class="art"><ItemIcon id={i.id} size={46} /></span>
                <span class="name">{i.label}</span>
                {i.id === item && <span class="tick"><Icon name="check" size={16} /></span>}
              </button>
            ))}
          </div>

          {error && <div class="err"><Icon name="x" size={20} /> Couldn't open that photo. Try again.</div>}
          <div class="cta-wrap">
            <button class="shoot" onClick={camera} aria-label="Take photo">
              <Icon name="camera" size={34} />
              <span>Count {cur.label.toLowerCase()}</span>
            </button>
          </div>
        </div>
      )}

      {step !== 'home' && (
        <div class="stage">
          <Viewer src={vSrc} imgW={vW} imgH={vH} mode={step} dots={vDots} box={step === 'pick' ? box : null} onBox={run}
            onTap={step === 'corners' ? addCorner : tapOne}
            gaps={step === 'edit' ? vGaps : undefined} onGap={openGap} focus={focus}
            corners={step === 'corners' ? corners : undefined}
            insetTop={step === 'edit' ? (warp ? 210 : 132) : 96} insetBottom={116}
            onAdd={d => { edit([...dots, fromView(d)]); dismissCoach() }}
            onRemove={i => { edit(dots.filter((_, j) => j !== i)); dismissCoach() }} />

          <div class="hud">
            <div class="hud-left">
              {step === 'corners' ? (
                <div class="ask" data-testid="hint">
                  <span class="ask-ic"><Icon name="grid" size={26} /></span>
                  <span class="hint">Tap the 4 corners of the ends<small>{corners.length} of 4</small></span>
                </div>
              ) : step === 'pick' ? (
                <div class={`ask ${missed ? 'missed' : ''}`} data-testid="hint">
                  <span class="ask-ic"><Icon name="draw" size={26} /></span>
                  <span class="hint">
                    {missed ? <>Nothing found. Draw a box around ONE {one}</> : <>Tap ONE {one}</>}
                    {!missed && <small>{warp ? 'on the straightened view' : 'or draw a box around it'}</small>}
                  </span>
                </div>
              ) : (
                <div class="readout">
                  <div class="count" key={dots.length} aria-live="polite" data-testid="count">{dots.length}</div>
                  <div class="what"><ItemIcon id={item} size={22} /><span>{cur.label}</span></div>
                  {session.length > 0 && (
                    <div class="total" data-testid="total">
                      <span>Total</span><b>{session.reduce((x, y) => x + y, 0) + dots.length}</b><small>{session.length + 1} photos</small>
                    </div>
                  )}
                  {warp && (
                    <div class="tabs" role="tablist">
                      <button role="tab" class={tab === 'photo' ? 'on' : ''} aria-selected={tab === 'photo'} onClick={() => setTab('photo')}>Photo</button>
                      <button role="tab" class={tab === 'straight' ? 'on' : ''} aria-selected={tab === 'straight'} onClick={() => setTab('straight')}>Straight</button>
                    </div>
                  )}
                  {gaps.length > 0 && (
                    <button class="check" data-testid="check" aria-label="Check spots" onClick={() => { setWalking(true) }}>
                      <b>{gaps.length}</b> to check
                    </button>
                  )}
                </div>
              )}
            </div>
            <div class="hud-right">
              {darkChip && <div class="warn"><Icon name="moon" size={18} /> {darkChip}</div>}
              {(step === 'pick' || step === 'edit') && (warp
                ? <button class="side" aria-label="Use original photo" onClick={clearWarp}><Icon name="undo" size={18} /> Original</button>
                : <button class="side" aria-label="Straighten" onClick={startStraighten}><Icon name="grid" size={18} /> Straighten</button>)}
            </div>
          </div>

          {busy && <div class="busy"><div class="scan" /><div class="pill"><span class="spin" /> Counting</div></div>}
          {toast && <div class="toast" role="status"><Icon name="check" size={18} /> {toast}</div>}

          {step === 'edit' && activeGap !== null && gaps[activeGap] && (
            <div class="sheet" role="dialog" aria-label="Check this spot">
              <p>Is there a tube here?</p>
              <div class="row">
                <button class="no" aria-label="Empty" onClick={() => resolveGap(false)}><Icon name="x" size={26} /> Empty</button>
                <button class="yes" aria-label="Add tube" onClick={() => resolveGap(true)}><Icon name="check" size={26} /> Tube</button>
              </div>
            </div>
          )}

          {step === 'edit' && activeGap === null && (
            <button class="add-photo" aria-label="Add another photo" onClick={addAnother}>
              <Icon name="camera" size={22} /><Icon name="plus" size={18} /><span>Add photo</span>
            </button>
          )}

          {step === 'edit' && coach && activeGap === null && (
            <div class="coach">
              <div class="coach-row"><span class="chip rm"><i /></span> Tap a dot to remove</div>
              <div class="coach-row"><span class="chip add"><i /></span> Tap empty space to add</div>
              <div class="coach-row"><span class="chip pinch"><Icon name="plus" size={14} /></span> Pinch or + to zoom</div>
              <button class="coach-ok" aria-label="Got it" onClick={dismissCoach}><Icon name="check" size={22} /></button>
            </div>
          )}

          <nav class="dock">
            <button class="d" aria-label="Home" onClick={goHome}><Icon name="home" /><span>Home</span></button>
            {step === 'corners' && (
              <button class="d" aria-label="Undo corner" disabled={!corners.length} onClick={() => setCorners(c => c.slice(0, -1))}>
                <Icon name="undo" /><span>Undo</span>
              </button>
            )}
            {step === 'edit' && <>
              <button class="d" aria-label="Undo" disabled={!undo.current.length}
                onClick={() => { const p = undo.current.pop(); if (p) { setDots(p); if (record.current) persist(thumb, p) } }}>
                <Icon name="undo" /><span>Undo</span>
              </button>
              <button class={`d good ${thumb === true ? 'sel' : ''}`} aria-label="Correct" onClick={() => rate(true)}>
                <Icon name="up" /><span>Right</span>
              </button>
              <button class={`d bad ${thumb === false ? 'sel' : ''}`} aria-label="Wrong" onClick={() => rate(false)}>
                <Icon name="down" /><span>Wrong</span>
              </button>
              <button class="d" aria-label="Share" onClick={share}><Icon name="share" /><span>Share</span></button>
            </>}
          </nav>
        </div>
      )}

      {asking && (
        <div class="modal" role="dialog" aria-label="Share photos">
          <div class="card">
            <div class="big"><Icon name="camera" size={36} /><span>→</span><Icon name="tap" size={36} /></div>
            <p>Share your photos to make counting better?</p>
            <small>Only the photo and your corrections. No name, no account.</small>
            <div class="yn">
              <button class="no" aria-label="No thanks" onClick={() => answer(false)}><Icon name="x" size={34} /></button>
              <button class="yes" aria-label="Yes, share" onClick={() => answer(true)}><Icon name="check" size={34} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
