import { expect, type Page, test } from '@playwright/test'

const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

/** EXIF with a GPS position, as a phone writes it: an APP1 segment. */
function gpsExif(): Buffer {
  const tiff = Buffer.alloc(8 + 18 + 18)
  tiff.write('MM\0*', 0, 'latin1')
  tiff.writeUInt32BE(8, 4)
  // IFD0: one entry, GPSInfo (0x8825) → GPS IFD at offset 26.
  tiff.writeUInt16BE(1, 8)
  tiff.writeUInt16BE(0x8825, 10)
  tiff.writeUInt16BE(4, 12)
  tiff.writeUInt32BE(1, 14)
  tiff.writeUInt32BE(26, 18)
  tiff.writeUInt32BE(0, 22)
  // GPS IFD: GPSLatitudeRef = "N".
  tiff.writeUInt16BE(1, 26)
  tiff.writeUInt16BE(0x0001, 28)
  tiff.writeUInt16BE(2, 30)
  tiff.writeUInt32BE(2, 32)
  tiff.write('N\0', 36, 'latin1')
  tiff.writeUInt32BE(0, 40)
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const head = Buffer.alloc(4)
  head.writeUInt16BE(0xffe1, 0)
  head.writeUInt16BE(body.length + 2, 2)
  return Buffer.concat([head, body])
}

/** A 4000 × 3000 JPEG drawn in the browser, with GPS EXIF added like a camera's. */
async function largeJpegWithGps(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4000
    canvas.height = 3000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    const gradient = ctx.createLinearGradient(0, 0, 4000, 3000)
    gradient.addColorStop(0, '#2d6a4f')
    gradient.addColorStop(1, '#d8f3dc')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 4000, 3000)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.95)
    })
    if (!blob) throw new Error('no blob')
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  const jpeg = Buffer.from(bytes)
  return Buffer.concat([jpeg.subarray(0, 2), gpsExif(), jpeg.subarray(2)])
}

test('a large JPEG uploads, shows at all four widths, and its GPS data is gone', async ({
  page,
}) => {
  const name = unique('Kranabíll')
  await page.goto('/vefstjorn/equipment')
  const jpeg = await largeJpegWithGps(page)
  expect(jpeg.includes('Exif')).toBe(true)

  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(name)
  await page.getByLabel('Mynd').setInputFiles({
    name: 'IMG_0001.JPG',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  })
  const preview = page.getByRole('img', { name: 'Valin mynd' })
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
  await page.getByRole('radio', { name: 'Birt' }).check()
  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')

  await page.goto('/')
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) })
  // The heading names the photo, so it has an empty alt and no img role.
  const srcset = await card.locator('img').getAttribute('srcset')
  const urls = (srcset ?? '').split(', ').map((s) => s.split(' ')[0] ?? '')
  expect(urls.map((u) => u.split('/')[2])).toEqual(['480', '960', '1440', '1920'])

  for (const url of urls) {
    const width = Number(url.split('/')[2])
    const res = await page.request.get(url, { headers: { accept: 'image/webp,*/*' } })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/webp')
    const body = await res.body()
    expect(body.includes('Exif')).toBe(false)
    const natural = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      return img.naturalWidth
    }, url)
    expect(natural).toBe(width)
  }
})

test('a photo nobody can read gets an Icelandic message', async ({ page }) => {
  await page.goto('/vefstjorn/equipment')
  await page.getByRole('button', { name: 'Nýtt' }).click()
  // Chromium can't decode HEIC, so this goes the raw path, and the Worker can't read it either.
  await page.getByLabel('Mynd').setInputFiles({
    name: 'IMG_0002.HEIC',
    mimeType: 'image/heic',
    buffer: Buffer.from('not really a photo'),
  })
  await expect(page.getByRole('alert')).toHaveText(
    'Ekki tókst að lesa myndina. Notaðu JPG, PNG, HEIC eða WebP.',
  )
})
