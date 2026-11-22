import { expect, test } from '@playwright/test'

test('Síður og textar lists the pages and the footer', async ({ page }) => {
  await page.goto('/vefstjorn')
  const nav = page.getByRole('navigation', { name: 'Vefstjórn' })
  await expect(nav.getByRole('link', { name: 'Fótur' })).toHaveCount(0)
  await nav.getByRole('link', { name: 'Síður og textar' }).click()
  await expect(page.getByRole('heading', { name: 'Síður og textar' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Forsíða/ })).toBeVisible()
  await page.getByRole('link', { name: 'Fótur' }).click()
  await expect(page.getByRole('heading', { name: 'Fótur' })).toBeVisible()
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
  await page.getByLabel('Fyrirsögn').fill('Við mótum lóðina þína')
  await page.getByLabel('Inngangstexti').fill(lead)
  await page.getByRole('textbox', { name: 'Titill', exact: true }).fill(seoTitle)
  await page.getByRole('textbox', { name: 'Lýsing', exact: true }).fill('')

  // The Google preview shows the title, and the lead stands in for the empty description.
  const preview = page.getByRole('group', { name: 'Forskoðun á Google' })
  await expect(preview).toContainText(seoTitle)
  await expect(preview).toContainText(lead)
  await expect(preview).toContainText('berghald.is')

  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')

  await page.goto('/')
  await expect(page).toHaveTitle(seoTitle)
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', lead)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', seoTitle)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Við mótum lóðina þína')
  await expect(page.getByText(lead)).toBeVisible()
})
