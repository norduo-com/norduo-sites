import { expect, test } from '@playwright/test'

test('home page renders the hero', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Við mótum lóðina þína')
  await expect(page.locator('html')).toHaveAttribute('lang', 'is')
})

test('Vefstjórn lists the content types from cms.config.ts', async ({ page }) => {
  await page.goto('/vefstjorn')
  const nav = page.getByRole('navigation', { name: 'Vefstjórn' })
  await expect(nav.getByRole('link', { name: 'Verkefni' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Myndasafn' })).toBeVisible()
})

test('CMS API answers health checks', async ({ request }) => {
  const res = await request.get('/api/cms/health')
  expect(await res.json()).toEqual({ ok: true, site: 'berghald' })
})
