import { useEffect, useRef, useState } from 'preact/hooks'
import { Viewer } from './ui/Viewer'
import { Icon, ItemIcon, Logo } from './ui/icons'
import { autoContrast, countSimilar, toGray, type Box, type Dot, type Gray } from './infer/exemplar'
import { lightingScore, type Lighting } from './infer/lighting'
import { detect, detectorVersion, loadDetector } from './infer/detector'
import {
  bumpUse, getConsent, orderedItems, pendingCount, saveFeedback, setConsent, updateFeedback,
  type FeedbackRecord, type ItemId,
} from './feedback/store'
import { syncConfig, syncPending } from './feedback/sync'
import './app.css'

type Step = 'home' | 'pick' | 'edit'
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
  const [coach, setCoach] = useState(() => { try { return localStorage.getItem('pc.coach') !== '1' } catch { return true } })
  const usual = items[0]

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
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      if (src) URL.revokeObjectURL(src)
      photo.current = img
      setSrc(url); setBox(null); setDots([]); setThumb(null); setMissed(false)
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
    const rec: FeedbackRecord = {
      ...(record.current ?? {}), at: record.current?.at ?? Date.now(), item, image: file.current,
      imgW: size.w, imgH: size.h, exemplar: box, modelDots: modelDots.current, finalDots,
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
    c.width = size.w; c.height = size.h
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const r = Math.max(10, size.w / 90)
    ctx.font = `bold ${r * 1.4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    dots.forEach((d, i) => {
      ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), d.x, d.y)
    })
    const bar = size.h / 8
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, size.w, bar)
    ctx.fillStyle = '#fff'; ctx.font = `bold ${bar * 0.6}px sans-serif`; ctx.textAlign = 'left'
    ctx.fillText(`${dots.length}  ${item}`, bar * 0.3, bar / 2)
    const blob: Blob = await new Promise(r2 => c.toBlob(b => r2(b!), 'image/jpeg', 0.9))
    const f = new File([blob], `count-${dots.length}.jpg`, { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [f] })) navigator.share({ files: [f], text: `${dots.length} ${item}` }).catch(() => {})
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click() }
  }

  const goHome = () => { setStep('home'); leave().then(maybeAsk) }
  const camera = () => input.current?.click()
  const cur = items.find(i => i.id === item)!
  const rest = items.filter(i => i.id !== usual.id)
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
          <Viewer src={src} imgW={size.w} imgH={size.h} mode={step} dots={dots} box={step === 'pick' ? box : null} onBox={run}
            insetTop={step === 'pick' ? 96 : 132} insetBottom={116}
            onAdd={d => { edit([...dots, d]); dismissCoach() }}
            onRemove={i => { edit(dots.filter((_, j) => j !== i)); dismissCoach() }} />

          <div class="hud">
            {step === 'pick' ? (
              <div class={`ask ${missed ? 'missed' : ''}`} data-testid="hint">
                <span class="ask-ic"><Icon name="draw" size={26} /></span>
                <span class="hint">{missed ? 'Nothing found. ' : ''}Draw a box around ONE {cur.label.toLowerCase().replace(/s$/, '')}</span>
              </div>
            ) : (
              <div class="readout">
                <div class="count" key={dots.length} aria-live="polite" data-testid="count">{dots.length}</div>
                <div class="what"><ItemIcon id={item} size={22} /><span>{cur.label}</span></div>
              </div>
            )}
            {darkChip && <div class="warn"><Icon name="moon" size={18} /> {darkChip}</div>}
          </div>

          {busy && <div class="busy"><div class="scan" /><div class="pill"><span class="spin" /> Counting</div></div>}
          {toast && <div class="toast" role="status"><Icon name="check" size={18} /> {toast}</div>}

          {step === 'edit' && coach && (
            <div class="coach">
              <div class="coach-row"><span class="chip rm"><i /></span> Tap a dot to remove</div>
              <div class="coach-row"><span class="chip add"><i /></span> Tap empty space to add</div>
              <div class="coach-row"><span class="chip pinch"><Icon name="plus" size={14} /></span> Pinch or + to zoom</div>
              <button class="coach-ok" aria-label="Got it" onClick={dismissCoach}><Icon name="check" size={22} /></button>
            </div>
          )}

          <nav class="dock">
            <button class="d" aria-label="Home" onClick={goHome}><Icon name="home" /><span>Home</span></button>
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
