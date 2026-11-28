import { expect, test } from '@playwright/test'

// Two tests edit the same home page, so the file runs one test at a time.
test.describe.configure({ mode: 'serial' })

test('Síður og textar lists the pages and the footer', async ({ page }) => {
  await page.goto('/vefstjorn')
  const nav = page.getByRole('navigation', { name: 'Vefstjórn', exact: true })
  await expect(nav.getByRole('link', { name: 'Fótur', exact: true })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Síður og textar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Síður og textar', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Forsíða/ })).toBeVisible()
  await page.getByRole('link', { name: 'Fótur', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Fótur', exact: true })).toBeVisible()
})

test('the home page header and SEO save and go straight to the public <head>', async ({
  page,
}, testInfo) => {
  // Both projects would edit the same page at once.
  test.skip(testInfo.project.name !== 'desktop', 'edits the shared home page')
  const id = crypto.randomUUID().slice(0, 8)
  const seoTitle = `Berghald – garðar ${id}`
  const lead = `Við sjáum um lóðina frá upphafi til enda ${id}.`

  await page.goto('/vefstjorn/pages')
  await page.getByRole('link', { name: /Forsíða/ }).click()
  await page.getByRole('textbox', { name: 'Heiti', exact: true }).fill('Forsíða')
  // The header comes first; blocks below it may have fields with the same labels.
  await page.getByLabel('Fyrirsögn').first().fill('Við mótum lóðina þína')
  await page.getByLabel('Inngangstexti').first().fill(lead)
  await page.getByRole('textbox', { name: 'Titill', exact: true }).fill(seoTitle)
  await page.getByRole('textbox', { name: 'Lýsing', exact: true }).fill('')

  // The Google preview shows the title, and the lead stands in for the empty description.
  const preview = page.getByRole('group', { name: 'Forskoðun á Google', exact: true })
  await expect(preview).toContainText(seoTitle)
  await expect(preview).toContainText(lead)
  await expect(preview).toContainText('berghald.is')

  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')

  await page.goto('/')
  await expect(page).toHaveTitle(seoTitle)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', lead)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', seoTitle)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Við mótum lóðina þína')
  await expect(page.getByText(lead, { exact: true })).toBeVisible()
})

test('home page blocks are added, reordered and removed, and the public page follows', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'edits the shared home page')
  const id = crypto.randomUUID().slice(0, 8)
  const textHeading = `Um garðana ${id}`
  const formHeading = `Fáðu tilboð ${id}`
  const secondHeading = `Hleðslur ${id}`
  const save = async () => {
    await page.getByRole('button', { name: 'Vista', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Vistað')
  }
  const addBlock = async (type: string) => {
    await page
      .getByRole('combobox', { name: 'Tegund hluta', exact: true })
      .selectOption({ label: type })
    await page.getByRole('button', { name: 'Bæta við hluta', exact: true }).click()
  }

  await page.goto('/vefstjorn/pages/home')
  await page.getByRole('textbox', { name: 'Heiti', exact: true }).fill('Forsíða')
  // Start from an empty body.
  const removeButtons = page.getByRole('button', { name: /^Fjarlægja: / })
  await expect(page.getByRole('button', { name: 'Bæta við hluta', exact: true })).toBeVisible()
  while ((await removeButtons.count()) > 0) await removeButtons.first().click()
  await expect(page.getByText('Engir hlutar á síðunni enn.', { exact: true })).toBeVisible()

  await addBlock('Texti')
  const text = page.getByRole('region', { name: '1. Texti', exact: true })
  await text.getByLabel('Fyrirsögn').fill(textHeading)
  await text
    .getByRole('textbox', { name: 'Texti', exact: true })
    .fill('Við hönnum og byggjum garða.')
  await addBlock('Tilboðsform')
  await page
    .getByRole('region', { name: '2. Tilboðsform', exact: true })
    .getByLabel('Fyrirsögn')
    .fill(formHeading)

  // The form moves above the text; focus stays on the moved block and the text keeps its content.
  await page.getByRole('button', { name: 'Færa upp: 2. Tilboðsform', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Færa niður: 1. Tilboðsform', exact: true }),
  ).toBeFocused()
  const moved = page.getByRole('region', { name: '2. Texti', exact: true })
  await expect(moved.getByLabel('Fyrirsögn')).toHaveValue(textHeading)
  await expect(moved.getByRole('textbox', { name: 'Texti', exact: true })).toHaveText(
    'Við hönnum og byggjum garða.',
  )
  await save()

  await page.goto('/')
  const headings = page.locator('[data-block] h2')
  await expect(headings).toHaveText([formHeading, textHeading])
  await expect(page.getByText('Við hönnum og byggjum garða.', { exact: true })).toBeVisible()

  // Blocks loaded from D1 keep their own rich text when moved, not just new ones.
  await page.goto('/vefstjorn/pages/home')
  await addBlock('Texti')
  const second = page.getByRole('region', { name: '3. Texti', exact: true })
  await second.getByLabel('Fyrirsögn').fill(secondHeading)
  await second
    .getByRole('textbox', { name: 'Texti', exact: true })
    .fill('Við hlöðum veggi úr grjóti.')
  await save()
  await page.reload()
  await page.getByRole('button', { name: 'Færa upp: 3. Texti', exact: true }).click()
  const body = (n: number) =>
    page
      .getByRole('region', { name: `${String(n)}. Texti`, exact: true })
      .getByRole('textbox', { name: 'Texti', exact: true })
  await expect(body(2)).toHaveText('Við hlöðum veggi úr grjóti.')
  await expect(body(3)).toHaveText('Við hönnum og byggjum garða.')
  await save()

  await page.goto('/')
  await expect(headings).toHaveText([formHeading, secondHeading, textHeading])

  await page.goto('/vefstjorn/pages/home')
  await page.getByRole('button', { name: 'Fjarlægja: 3. Texti', exact: true }).click()
  await page.getByRole('button', { name: 'Fjarlægja: 2. Texti', exact: true }).click()
  await expect(page.getByRole('region', { name: /Texti$/ })).toHaveCount(0)
  await save()

  await page.goto('/')
  await expect(headings).toHaveText([formHeading])

  // Removing the last block saves an empty page body.
  await page.goto('/vefstjorn/pages/home')
  await page.getByRole('button', { name: 'Fjarlægja: 1. Tilboðsform', exact: true }).click()
  await save()
  await page.reload()
  await expect(page.getByText('Engir hlutar á síðunni enn.', { exact: true })).toBeVisible()
  await page.goto('/')
  await expect(page.locator('[data-block]')).toHaveCount(0)
})
