import { useEffect, useRef, useState } from 'preact/hooks'
import { Viewer } from './ui/Viewer'
import { autoContrast, countSimilar, toGray, type Box, type Dot, type Gray } from './infer/exemplar'
import { lightingScore, type Lighting } from './infer/lighting'
import {
  bumpUse, getConsent, orderedItems, pendingCount, saveFeedback, setConsent, updateFeedback,
  type FeedbackRecord, type ItemId,
} from './feedback/store'
import { syncConfig, syncPending } from './feedback/sync'
import './app.css'

type Step = 'home' | 'pick' | 'edit'
const MODEL_VERSION = 'ncc-v0'

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
  const canShare = syncConfig() !== null

  const refreshPending = () => pendingCount().then(setPending)
  const sync = () => syncPending().then(refreshPending)

  useEffect(() => {
    refreshPending()
    sync()
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
    img.onerror = () => { URL.revokeObjectURL(url); setError('📷 ❌') }
    img.onload = () => {
      const raw = toGray(img, img.naturalWidth, img.naturalHeight)
      setLight(lightingScore(raw))
      gray.current = autoContrast(raw)
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      if (src) URL.revokeObjectURL(src)
      setSrc(url); setBox(null); setDots([]); setThumb(null)
      undo.current = []; record.current = null
      setStep('pick')
    }
    img.src = url
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
      thumbsUp: up, lighting: light, modelVersion: MODEL_VERSION, uploaded: 0,
    }
    if (record.current?.id !== undefined) await updateFeedback(rec)
    else rec.id = (await saveFeedback(rec)) ?? undefined
    record.current = rec
    refreshPending()
  }

  const rate = (up: boolean) => { setThumb(up); persist(up).then(maybeAsk) }

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

  return (
    <div class="app">
      <input ref={input} data-testid="camera" type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {step === 'home' && (
        <div class="home">
          <div class="grid">
            {items.map(i => (
              <button key={i.id} class={`tile ${i.id === item ? 'on' : ''}`} onClick={() => setItem(i.id)}>
                <span class="ic">{i.icon}</span>{i.label}
              </button>
            ))}
          </div>
          {error && <div class="err">{error}</div>}
          <div class="homebar">
            <button class="shoot" onClick={camera} aria-label="Take photo">📷 {cur.icon}</button>
            {canShare && (
              <button class={`cloud ${consent ? 'on' : ''}`} aria-label="Share photos to improve counting"
                onClick={() => answer(!consent)}>
                {consent ? '☁️' : '🔒'}{consent && pending > 0 && <small>{pending}</small>}
              </button>
            )}
          </div>
        </div>
      )}

      {step !== 'home' && (
        <>
          <div class="top">
            {step === 'pick' ? <div class="hint">👆 Draw a box around ONE {cur.label.toLowerCase()}</div>
              : <div class="count" aria-live="polite" data-testid="count">{dots.length}</div>}
            {light && light.bucket !== 'good' && <div class="warn">🔦 {light.bucket === 'poor' ? 'Dark' : 'Dim'}</div>}
          </div>
          <Viewer src={src} imgW={size.w} imgH={size.h} mode={step} dots={dots} box={box} onBox={run}
            onAdd={d => edit([...dots, d])}
            onRemove={i => edit(dots.filter((_, j) => j !== i))} />
          {busy && <div class="busy">…</div>}
          <div class="bar">
            <button aria-label="Home" onClick={goHome}>🏠</button>
            {step === 'edit' && <>
              <button aria-label="Undo" disabled={!undo.current.length}
                onClick={() => { const p = undo.current.pop(); if (p) { setDots(p); if (record.current) persist(thumb, p) } }}>↩️</button>
              <button aria-label="Correct" class={thumb === true ? 'sel' : ''} onClick={() => rate(true)}>👍</button>
              <button aria-label="Wrong" class={thumb === false ? 'sel' : ''} onClick={() => rate(false)}>👎</button>
              <button aria-label="Share" onClick={share}>📤</button>
            </>}
          </div>
        </>
      )}

      {asking && (
        <div class="modal" role="dialog" aria-label="Share photos">
          <div class="card">
            <div class="big">📤 📷 ➜ 🎯</div>
            <p>Share your photos to make counting better?</p>
            <div class="yn">
              <button class="yes" aria-label="Yes, share" onClick={() => answer(true)}>✅</button>
              <button class="no" aria-label="No thanks" onClick={() => answer(false)}>❌</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
