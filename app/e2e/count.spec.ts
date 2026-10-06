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

test('tap a dot to remove it, tap empty space to add one, undo reverses', async ({ page }) => {
  const photo = await load(page)
  await boxFirstItem(page)
  const count = page.getByTestId('count')
  await expect(count).toHaveText(String(photo.truth))

  await page.locator('.dot').first().click()
  await expect(count).toHaveText(String(photo.truth - 1))

  const v = (await page.locator('.viewer').boundingBox())!
  await page.mouse.click(v.x + 8, v.y + v.height - 8) // empty corner of the viewer
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
