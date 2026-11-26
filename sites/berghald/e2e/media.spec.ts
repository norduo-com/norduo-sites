import { expect, type Page, test } from '@playwright/test'

/** The local D1 persists between runs, so every name is one no other run uses. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

/** Uploads a small WebP master drawn in the browser, as Vefstjórn would. */
async function uploadPhoto(page: Page, filename: string): Promise<string> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#2d6a4f'
    ctx.fillRect(0, 0, 320, 240)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.9)
    })
    if (!blob) throw new Error('no blob')
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  const res = await page.request.post('/api/cms/admin/media', {
    multipart: { file: { name: filename, mimeType: 'image/webp', buffer: Buffer.from(bytes) } },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { id: string }).id
}

async function createItem(page: Page, type: string, data: Record<string, unknown>) {
  const res = await page.request.post(`/api/cms/admin/content/${type}`, {
    data: { status: 'published', data },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { slug: string }).slug
}

const card = (page: Page, filename: string) => page.getByRole('listitem', { name: filename })

test('a photo in an image() field cannot be deleted until it is replaced', async ({ page }) => {
  await page.goto('/vefstjorn/media')
  const filename = `${unique('krani')}.webp`
  const name = unique('Kranabíll')
  const id = await uploadPhoto(page, filename)
  await createItem(page, 'equipment', { name, photo: { mediaId: id } })

  await page.reload()
  const photo = card(page, filename)
  await expect(photo).toContainText('Notuð í: Tæki')
  await photo.getByRole('button', { name: 'Eyða' }).click()
  const alert = photo.getByRole('alert')
  await expect(alert).toContainText('Ekki er hægt að eyða myndinni')
  await expect(alert.getByRole('link', { name: `Tæki: ${name}` })).toHaveAttribute(
    'href',
    '/vefstjorn/equipment',
  )
  await expect(photo.getByRole('button', { name: 'Já, eyða' })).toHaveCount(0)

  // The API refuses too, even when asked to clear galleries.
  const res = await page.request.delete(`/api/cms/admin/media/${id}?galleries=remove`)
  expect(res.status()).toBe(409)
  await page.reload()
  await expect(card(page, filename)).toBeVisible()
})

test('a photo in a gallery is removed from it after confirming', async ({ page }) => {
  await page.goto('/vefstjorn/media')
  const filename = `${unique('gardur')}.webp`
  const keep = await uploadPhoto(page, `${unique('annad')}.webp`)
  const id = await uploadPhoto(page, filename)
  const title = unique('Garður')
  const slug = await createItem(page, 'projects', {
    title,
    photos: [
      { kind: 'image', mediaId: id },
      { kind: 'image', mediaId: keep },
    ],
  })

  await page.reload()
  const photo = card(page, filename)
  await expect(photo).toContainText('Notuð í: Verkefni')
  await photo.getByRole('button', { name: 'Eyða' }).click()
  const alert = photo.getByRole('alert')
  await expect(alert).toContainText('Myndin verður tekin úr myndaröðum')
  await expect(alert.getByRole('link', { name: `Verkefni: ${title}` })).toBeVisible()
  await alert.getByRole('button', { name: 'Já, eyða' }).click()
  await expect(card(page, filename)).toHaveCount(0)

  const project = await page.request.get(`/api/cms/admin/content/projects/${slug}`)
  const { data } = (await project.json()) as { data: { photos: { mediaId: string }[] } }
  expect(data.photos).toEqual([{ kind: 'image', mediaId: keep }])
  await page.reload()
  await expect(card(page, filename)).toHaveCount(0)
})

test('alt text is saved once and the Án lýsingar filter follows it', async ({ page }) => {
  await page.goto('/vefstjorn/media')
  const filename = `${unique('steinn')}.webp`
  await uploadPhoto(page, filename)
  await page.reload()
  const filter = page.getByLabel('Sýna')

  await filter.selectOption({ label: 'Án lýsingar' })
  const photo = card(page, filename)
  await expect(photo).toBeVisible()
  await expect(photo).toContainText('Ónotaðar')
  await photo.getByLabel('Lýsing').fill('Hlaðinn steinveggur')
  await photo.getByRole('button', { name: 'Vista lýsingu' }).click()
  // It has a description now, so it leaves this filter.
  await expect(card(page, filename)).toHaveCount(0)

  await filter.selectOption({ label: 'Ónotaðar' })
  await expect(card(page, filename)).toBeVisible()
  await page.reload()
  await expect(card(page, filename).getByLabel('Lýsing')).toHaveValue('Hlaðinn steinveggur')
})
