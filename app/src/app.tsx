import { useRef, useState } from 'preact/hooks'
import { Viewer } from './ui/Viewer'
import { autoContrast, countSimilar, toGray, type Box, type Dot, type Gray } from './infer/exemplar'
import { lightingScore, type Lighting } from './infer/lighting'
import { bumpUse, orderedItems, saveFeedback, type ItemId } from './feedback/store'
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
  const file = useRef<File | null>(null)
  const gray = useRef<Gray | null>(null)
  const modelDots = useRef<Dot[]>([])
  const undo = useRef<Dot[][]>([])
  const input = useRef<HTMLInputElement>(null)

  const onFile = (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    file.current = f
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      setSize({ w: img.naturalWidth, h: img.naturalHeight })
      gray.current = autoContrast(toGray(img, img.naturalWidth, img.naturalHeight))
      setLight(lightingScore(toGray(img, img.naturalWidth, img.naturalHeight)))
      setSrc(url); setBox(null); setDots([]); setThumb(null); undo.current = []
      setStep('pick')
    }
    img.src = url
    ;(e.target as HTMLInputElement).value = ''
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

  const finish = async (up: boolean | null) => {
    setThumb(up)
    if (file.current && box && light) {
      await saveFeedback({
        at: Date.now(), item, image: file.current, exemplar: box,
        modelDots: modelDots.current, finalDots: dots, thumbsUp: up,
        lighting: light, modelVersion: MODEL_VERSION, uploaded: 0,
      })
    }
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

  const camera = () => input.current?.click()
  const cur = items.find(i => i.id === item)!

  return (
    <div class="app">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {step === 'home' && (
        <div class="home">
          <div class="grid">
            {items.map(i => (
              <button key={i.id} class={`tile ${i.id === item ? 'on' : ''}`} onClick={() => setItem(i.id)}>
                <span class="ic">{i.icon}</span>{i.label}
              </button>
            ))}
          </div>
          <button class="shoot" onClick={camera}>📷 {cur.icon}</button>
        </div>
      )}

      {step !== 'home' && (
        <>
          <div class="top">
            {step === 'pick' ? <div class="hint">👆 Draw a box around ONE {cur.label.toLowerCase()}</div>
              : <div class="count" aria-live="polite">{dots.length}</div>}
            {light && light.bucket !== 'good' && <div class="warn">🔦 {light.bucket === 'poor' ? 'Dark' : 'Dim'}</div>}
          </div>
          <Viewer src={src} imgW={size.w} imgH={size.h} mode={step} dots={dots} box={box} onBox={run}
            onAdd={d => edit([...dots, d])}
            onRemove={i => edit(dots.filter((_, j) => j !== i))} />
          {busy && <div class="busy">…</div>}
          <div class="bar">
            <button onClick={() => { setStep('home') }}>🏠</button>
            {step === 'edit' && <>
              <button disabled={!undo.current.length} onClick={() => { const p = undo.current.pop(); if (p) setDots(p) }}>↩️</button>
              <button class={thumb === true ? 'sel' : ''} onClick={() => finish(true)}>👍</button>
              <button class={thumb === false ? 'sel' : ''} onClick={() => finish(false)}>👎</button>
              <button onClick={share}>📤</button>
            </>}
          </div>
        </>
      )}
    </div>
  )
}
