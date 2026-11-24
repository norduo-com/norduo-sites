import { expect, type Page, test } from '@playwright/test'

/** The local D1 persists between runs, so every item gets a name no other run uses. */
const tag = () => crypto.randomUUID().slice(0, 8)

/** A small JPEG drawn in the browser. */
async function jpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#2d6a4f'
    ctx.fillRect(0, 0, 800, 600)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    })
    if (!blob) throw new Error('no blob')
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  return Buffer.from(bytes)
}

test('a gallery takes a photo, an MP4 and a YouTube link, keeps their order and its cover', async ({
  page,
}) => {
  const title = `Hellulögn ${tag()}`
  await page.goto('/vefstjorn/projects')
  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(title)
  const gallery = page.getByRole('group', { name: 'Myndir og myndbönd' })

  await gallery.getByLabel('Bæta við myndum').setInputFiles({
    name: 'IMG_0001.JPG',
    mimeType: 'image/jpeg',
    buffer: await jpeg(page),
  })
  await expect(gallery.getByText('Mynd 1', { exact: true })).toBeVisible()

  // Not a real film: the server checks size and type, not the frames.
  const clip = Buffer.alloc(2 * 1024 * 1024, 7)
  await gallery.getByLabel('Bæta við myndbandi').setInputFiles({
    name: 'klippa.mp4',
    mimeType: 'video/mp4',
    buffer: clip,
  })
  await expect(gallery.getByText('Myndband 2', { exact: true })).toBeVisible({ timeout: 15_000 })

  await gallery.getByLabel('Tengill á YouTube eða Vimeo').fill('https://example.com/myndband')
  await gallery.getByRole('button', { name: 'Bæta við tengli' }).click()
  await expect(gallery.getByRole('alert')).toHaveText(
    'Sláðu inn tengil á myndband á YouTube eða Vimeo.',
  )
  await gallery.getByLabel('Tengill á YouTube eða Vimeo').fill('https://youtu.be/dQw4w9WgXcQ')
  await gallery.getByRole('button', { name: 'Bæta við tengli' }).click()
  await expect(gallery.getByText('Tengt myndband 3', { exact: true })).toBeVisible()

  // The photo is the cover by default; a video can't be until it has its own photo.
  const covers = gallery.getByRole('radio', { name: /Forsíðumynd/ })
  await expect(covers.nth(0)).toBeChecked()
  await expect(covers.nth(1)).toBeDisabled()
  await gallery.getByRole('button', { name: 'Færa atriði 3 upp' }).click()

  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByText('Vistað')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  const items = gallery.getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Mynd 1')
  await expect(items.nth(1)).toContainText('Tengt myndband 2')
  await expect(items.nth(1)).toContainText('https://youtu.be/dQw4w9WgXcQ')
  await expect(items.nth(2)).toContainText('Myndband 3')

  // The site serves the MP4 as stored, in byte ranges for seeking.
  const src = await items.nth(2).locator('video').getAttribute('src')
  expect(src).toMatch(/^\/video\/[0-9a-f-]{36}\.mp4$/)
  const part = await page.request.get(src ?? '', { headers: { range: 'bytes=0-99' } })
  expect(part.status()).toBe(206)
  expect(part.headers()['content-range']).toBe(`bytes 0-99/${String(clip.length)}`)
})

/** A real 2 s MP4 (VP9, which Chromium can both record and decode) of a moving square. */
async function recordedMp4(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    const recorder = new MediaRecorder(canvas.captureStream(30), {
      mimeType: 'video/mp4;codecs=vp9',
    })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    const stopped = new Promise((resolve) => (recorder.onstop = resolve))
    recorder.start()
    const start = performance.now()
    await new Promise<void>((resolve) => {
      const draw = () => {
        const t = (performance.now() - start) / 2000
        ctx.fillStyle = '#d8f3dc'
        ctx.fillRect(0, 0, 320, 240)
        ctx.fillStyle = '#2d6a4f'
        ctx.fillRect(t * 260, 90, 60, 60)
        if (t < 1) requestAnimationFrame(draw)
        else resolve()
      }
      draw()
    })
    recorder.stop()
    await stopped
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
  })
  return Buffer.from(bytes)
}

test('a video gets a still from itself as its poster, so it can be the cover', async ({ page }) => {
  await page.goto('/vefstjorn/projects')
  const clip = await recordedMp4(page)
  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(`Myndband ${tag()}`)
  const gallery = page.getByRole('group', { name: 'Myndir og myndbönd' })
  await gallery.getByLabel('Bæta við myndbandi').setInputFiles({
    name: 'klippa.mp4',
    mimeType: 'video/mp4',
    buffer: clip,
  })
  const item = gallery.getByRole('listitem')
  await expect(item).toContainText('Myndband 1', { timeout: 15_000 })
  await expect(item.getByRole('button', { name: 'Skipta um mynd fyrir myndband' })).toBeVisible()
  const cover = item.getByRole('radio', { name: 'Forsíðumynd' })
  await expect(cover).toBeEnabled()
  // No photo in the gallery, so the video's poster is the cover.
  await expect(cover).toBeChecked()
  const poster = item.locator('img')
  await expect.poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320)
})

test('a video PUT larger than declared is refused and nothing is stored', async ({ page }) => {
  const ticket = await page.request.post('/api/cms/admin/media/video', {
    data: { size: 1000, type: 'video/mp4' },
  })
  expect(ticket.status()).toBe(201)
  const { id, url } = (await ticket.json()) as { id: string; url: string }
  const put = (size: number) =>
    page.request.put(url, {
      headers: { 'content-type': 'video/mp4' },
      data: Buffer.alloc(size, 1),
    })
  expect((await put(1001)).status()).toBe(403)
  const done = await page.request.post(`/api/cms/admin/media/video/${id}`, { data: {} })
  expect(done.status()).toBe(404)

  expect((await put(1000)).status()).toBe(200)
  expect((await page.request.post(`/api/cms/admin/media/video/${id}`, { data: {} })).status()).toBe(
    201,
  )
})

test('a video over 200 MB is refused before it uploads', async ({ page }) => {
  const res = await page.request.post('/api/cms/admin/media/video', {
    data: { size: 200 * 1024 * 1024 + 1, type: 'video/mp4' },
  })
  expect(res.status()).toBe(413)
})
