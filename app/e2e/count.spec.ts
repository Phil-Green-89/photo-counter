import { expect, test, type Page } from '@playwright/test'
import { makePhoto } from './fixtures'

/** Draw a box around the first disc in the photo (image coords 100,90 r=50) with the real pointer. */
async function boxFirstItem(page: Page) {
  const r = (await page.locator('.viewer img').boundingBox())!
  const k = r.width / 900
  const cx = r.x + 100 * k, cy = r.y + 90 * k, rad = 50 * k
  await page.mouse.move(cx - rad, cy - rad)
  await page.mouse.down()
  await page.mouse.move(cx, cy, { steps: 4 })
  await page.mouse.move(cx + rad, cy + rad, { steps: 4 })
  await page.mouse.up()
}

async function load(page: Page, gain = 1) {
  await page.goto('/')
  const photo = await makePhoto(page, 7, 5, gain)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await expect(page.locator('.hint')).toBeVisible()
  return photo
}

test('home shows item tiles and a big camera button', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.tile')).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible()
})

test('draw a box around one item and every similar item is counted', async ({ page }) => {
  const photo = await load(page)
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
  await expect(page.locator('.dot')).toHaveCount(photo.truth)
})

test('tap one pipe and every similar pipe is counted, no box needed', async ({ page }) => {
  const photo = await load(page)
  const r = (await page.locator('.viewer img').boundingBox())!
  const k = r.width / 900
  await page.mouse.click(r.x + 100 * k, r.y + 90 * k)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
})

test('tapping empty background asks the user to draw a box instead', async ({ page }) => {
  await load(page)
  const r = (await page.locator('.viewer img').boundingBox())!
  await page.mouse.click(r.x + 8, r.y + 8)
  await expect(page.getByTestId('hint')).toContainText('Draw a box')
})

test('several photos keep a running total', async ({ page }) => {
  const photo = await load(page)
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
  await expect(page.getByTestId('total')).toHaveCount(0) // single photo: no total yet

  // second photo
  const second = await makePhoto(page, 4, 3)
  await page.locator('.dot').first().click() // remove one in photo 1 first: total must use the final count
  await page.getByRole('button', { name: 'Add another photo' }).click()
  await page.getByTestId('camera').setInputFiles({ name: 'p2.png', mimeType: 'image/png', buffer: second.png })
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(second.truth))
  await expect(page.getByTestId('total')).toContainText(String(photo.truth - 1 + second.truth))
  await expect(page.getByTestId('total')).toContainText('2 photos')

  // home starts a fresh job
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByTestId('camera').setInputFiles({ name: 'p3.png', mimeType: 'image/png', buffer: second.png })
  await boxFirstItem(page)
  await expect(page.getByTestId('total')).toHaveCount(0)
})

test('cancelling the camera after Add photo does not double count', async ({ page }) => {
  const photo = await load(page)
  await boxFirstItem(page)
  await page.getByRole('button', { name: 'Add another photo' }).click() // camera opens; user backs out (no file chosen)
  await page.getByRole('button', { name: 'Add another photo' }).click()
  await expect(page.getByTestId('total')).toHaveCount(0)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
})

test('tap a dot to remove it, tap empty space to add one, undo reverses', async ({ page }) => {
  const photo = await load(page)
  await boxFirstItem(page)
  const count = page.getByTestId('count')
  await expect(count).toHaveText(String(photo.truth))

  await page.locator('.dot').first().click()
  await expect(count).toHaveText(String(photo.truth - 1))

  const img = (await page.locator('.viewer img').boundingBox())!
  await page.mouse.click(img.x + 6, img.y + 6) // empty top-left corner of the photo
  await expect(count).toHaveText(String(photo.truth))

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(count).toHaveText(String(photo.truth - 1))
})

test('zoom keeps dots at a constant on-screen size', async ({ page }) => {
  await load(page)
  await boxFirstItem(page)
  const before = (await page.locator('.dot').first().boundingBox())!.width
  const t0 = await page.locator('.inner').getAttribute('style')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
  const after = (await page.locator('.dot').first().boundingBox())!.width
  expect(await page.locator('.inner').getAttribute('style')).not.toBe(t0)
  expect(Math.abs(after - before)).toBeLessThan(1.5)
})

test('a dim photo is flagged and still counted', async ({ page }) => {
  const photo = await load(page, 0.4)
  await expect(page.locator('.warn')).toBeVisible()
  await boxFirstItem(page)
  const n = Number(await page.getByTestId('count').textContent())
  expect(n).toBeGreaterThanOrEqual(photo.truth - 2)
  expect(n).toBeLessThanOrEqual(photo.truth + 2)
})

test('the most-counted item is pre-selected next time', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Boxes/ }).click()
  const photo = await makePhoto(page)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
  await page.reload()
  await expect(page.locator('.tile').first()).toContainText('Boxes')
  await expect(page.locator('.tile.on')).toContainText('Boxes')
})

test('opt-in: consent prompt, then photo + row uploaded with the public key', async ({ page }) => {
  const calls: { url: string; body: string | null; key: string | undefined }[] = []
  await page.route('https://demo.supabase.co/**', route => {
    const req = route.request()
    calls.push({ url: req.url(), body: req.postData(), key: req.headers()['apikey'] })
    route.fulfill({ status: 201, body: '' })
  })
  const photo = await load(page)
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))

  await page.getByRole('button', { name: 'Wrong' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(calls).toHaveLength(0) // nothing leaves the phone before the user says yes

  await page.getByRole('button', { name: 'Yes, share' }).click()
  await expect.poll(() => calls.length).toBe(2)
  expect(calls[0].url).toContain('/storage/v1/object/feedback-images/')
  expect(calls[1].url).toBe('https://demo.supabase.co/rest/v1/feedback')
  expect(calls.every(c => c.key === 'test-anon-key')).toBe(true)
  const row = JSON.parse(calls[1].body!)
  expect(row).toMatchObject({ item: 'pipes', thumbs_up: false, model_version: 'ncc-v0' })
  expect(row.final_dots).toHaveLength(photo.truth)
})

test('opt-out: saying no never uploads', async ({ page }) => {
  let hits = 0
  await page.route('https://demo.supabase.co/**', route => { hits++; route.fulfill({ status: 201, body: '' }) })
  await load(page)
  await boxFirstItem(page)
  await page.getByRole('button', { name: 'Correct' }).click()
  await page.getByRole('button', { name: 'No thanks' }).click()
  await page.getByRole('button', { name: 'Home' }).click()
  await page.waitForTimeout(500)
  expect(hits).toBe(0)
})

// ---- trained detector path (stub ONNX model: always "finds" a fixed 5x4 lattice) ----
import { readFileSync } from 'node:fs'

const STUB = readFileSync(new URL('./fixtures/stub-pipes.onnx', import.meta.url))

async function installModel(page: Page, conf = 0.25) {
  await page.route('**/models/manifest.json', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 'stub-1', file: 'pipes.onnx', inputSize: 640, numClasses: 1, conf, iou: 0.5 }),
  }))
  await page.route('**/models/pipes.onnx', r => r.fulfill({ contentType: 'application/octet-stream', body: STUB }))
}

test('pipes: the detector counts straight away, no box needed', async ({ page }) => {
  await installModel(page)
  await page.goto('/')
  const photo = await makePhoto(page)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await expect(page.getByTestId('count')).toHaveText('20', { timeout: 20_000 })
  await expect(page.locator('.dot')).toHaveCount(20)
  // dots map back inside the photo
  const v = (await page.locator('.viewer img').boundingBox())!
  for (const d of await page.locator('.dot').all()) {
    const b = (await d.boundingBox())!
    expect(b.x + b.width / 2).toBeGreaterThan(v.x - 1)
    expect(b.x + b.width / 2).toBeLessThan(v.x + v.width + 1)
  }
})

test('pipes: detector results are editable and recorded with the model version', async ({ page }) => {
  await installModel(page)
  const rows: string[] = []
  await page.route('https://demo.supabase.co/**', route => {
    const b = route.request().postData()
    if (b && b.startsWith('{')) rows.push(b)
    route.fulfill({ status: 201, body: '' })
  })
  await page.goto('/')
  const photo = await makePhoto(page)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await expect(page.getByTestId('count')).toHaveText('20', { timeout: 20_000 })
  await page.locator('.dot').first().click()
  await page.getByRole('button', { name: 'Wrong' }).click()
  await page.getByRole('button', { name: 'Yes, share' }).click()
  await expect.poll(() => rows.length).toBe(1)
  const row = JSON.parse(rows[0])
  expect(row.model_version).toBe('stub-1')
  expect(row.model_dots).toHaveLength(20)
  expect(row.final_dots).toHaveLength(19)
})

test('pipes: if the detector finds nothing the user can still draw a box', async ({ page }) => {
  await installModel(page, 0.95) // stub confidence is 0.9, so nothing passes
  await page.goto('/')
  const photo = await makePhoto(page)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await expect(page.getByTestId('hint')).toContainText('Nothing found', { timeout: 20_000 })
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
})

test('other items keep using tap-one even when a model is installed', async ({ page }) => {
  await installModel(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Boxes/ }).click()
  const photo = await makePhoto(page)
  await page.getByTestId('camera').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: photo.png })
  await expect(page.locator('.hint')).toBeVisible()
  await boxFirstItem(page)
  await expect(page.getByTestId('count')).toHaveText(String(photo.truth))
})

// ---- straighten + hidden-end checks ----
import { makeBundle } from './fixtures'

async function straightenAround(page: Page, corners: [number, number][]) {
  await page.getByRole('button', { name: 'Straighten' }).click()
  for (const [x, y] of corners) {
    const r = (await page.locator('.viewer img').boundingBox())!
    const k = r.width / 900
    await page.mouse.click(r.x + x * k, r.y + y * k)
  }
}
const FACE: [number, number][] = [[20, 25], [880, 25], [880, 565], [20, 565]]

test('straighten: tap 4 corners, then count on the straightened view', async ({ page }) => {
  await page.goto('/')
  const b = await makeBundle(page, [])
  await page.getByTestId('camera').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: b.png })
  await expect(page.getByTestId('hint')).toContainText('Tap ONE')
  await straightenAround(page, FACE)
  await expect(page.getByTestId('hint')).toContainText('straightened view')
  const r = (await page.locator('.viewer img').boundingBox())!
  // first end sits near the top-left of the face
  await page.mouse.click(r.x + r.width * (50 / 860), r.y + r.height * (45 / 540))
  await expect(page.getByTestId('count')).toHaveText('88', { timeout: 20_000 })
  await expect(page.getByTestId('check')).toHaveCount(0) // a complete bundle has nothing to check
  await expect(page.getByRole('tab', { name: 'Straight' })).toBeVisible()
})

test('straighten: corners that do not make a box are rejected with a message', async ({ page }) => {
  await page.goto('/')
  const b = await makeBundle(page, [])
  await page.getByTestId('camera').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: b.png })
  await straightenAround(page, [[100, 300], [300, 301], [500, 302], [700, 303]]) // all on one line
  await expect(page.getByRole('status')).toContainText('make a box')
  await expect(page.getByTestId('hint')).toContainText('4 corners')
})

test('hidden ends: empty spots inside the bundle are flagged and can be confirmed one by one', async ({ page }) => {
  await page.goto('/')
  const missing: [number, number][] = [[4, 3], [7, 4], [3, 5]]
  const b = await makeBundle(page, missing)
  await page.getByTestId('camera').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: b.png })
  await straightenAround(page, FACE)
  await expect(page.getByTestId('hint')).toContainText('straightened view') // wait for the warp before measuring
  const r = (await page.locator('.viewer img').boundingBox())!
  await page.mouse.click(r.x + r.width * (50 / 860), r.y + r.height * (45 / 540))
  await expect(page.getByTestId('count')).toHaveText(String(b.truth), { timeout: 20_000 })
  await expect(page.getByTestId('check')).toContainText('3 to check')
  await expect(page.locator('.gap')).toHaveCount(3)

  // the same spots show on the original photo too
  await page.getByRole('tab', { name: 'Photo' }).click()
  await expect(page.locator('.gap')).toHaveCount(3)
  await page.getByRole('tab', { name: 'Straight' }).click()

  await page.getByTestId('check').click()
  await expect(page.getByRole('dialog', { name: 'Check this spot' })).toBeVisible()
  await page.getByRole('button', { name: 'Add tube' }).click() // there IS a tube pushed back here
  await expect(page.getByTestId('count')).toHaveText(String(b.truth + 1))
  await expect(page.getByRole('dialog', { name: 'Check this spot' })).toBeVisible() // moves straight on to the next
  await page.getByRole('button', { name: 'Empty' }).click() // a real gap
  await expect(page.getByTestId('count')).toHaveText(String(b.truth + 1))
  await page.getByRole('button', { name: 'Empty' }).click()
  await expect(page.getByTestId('check')).toHaveCount(0)
  await expect(page.locator('.gap')).toHaveCount(0)
  await expect(page.getByTestId('count')).toHaveText(String(b.truth + 1))
})

test('straighten: Original goes back to the plain photo', async ({ page }) => {
  await page.goto('/')
  const b = await makeBundle(page, [])
  await page.getByTestId('camera').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: b.png })
  await straightenAround(page, FACE)
  await page.getByRole('button', { name: 'Use original photo' }).click()
  await expect(page.getByRole('button', { name: 'Straighten' })).toBeVisible()
})
