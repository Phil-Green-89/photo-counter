import type { Page } from '@playwright/test'

/** Build a photo of `cols*rows` pipe-like discs in the page and return it as a PNG buffer. */
export async function makePhoto(
  page: Page, cols = 7, rows = 5, gain = 1,
): Promise<{ png: Buffer; w: number; h: number; truth: number }> {
  const w = 900, h = 700
  const b64: string = await page.evaluate(({ cols, rows, gain, w, h }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const x = c.getContext('2d')!
    const s = (n: number) => Math.round(n * gain)
    x.fillStyle = `rgb(${s(58)},${s(58)},${s(58)})`; x.fillRect(0, 0, w, h)
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const cx = 100 + q * 110 + (r % 2) * 40, cy = 90 + r * 115
      const g = x.createRadialGradient(cx, cy, 10, cx, cy, 45)
      g.addColorStop(0, `rgb(${s(17)},${s(17)},${s(17)})`)
      g.addColorStop(0.55, `rgb(${s(34)},${s(34)},${s(34)})`)
      g.addColorStop(0.6, `rgb(${s(201)},${s(123)},${s(58)})`)
      g.addColorStop(1, `rgb(${s(232)},${s(164)},${s(104)})`)
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 45, 0, 7); x.fill()
    }
    return c.toDataURL('image/png').split(',')[1]
  }, { cols, rows, gain, w, h })
  return { png: Buffer.from(b64, 'base64'), w, h, truth: cols * rows }
}
