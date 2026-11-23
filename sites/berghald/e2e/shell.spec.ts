import { expect, test } from '@playwright/test'

test('Icelandic pages sit at the root and English ones under /en', async ({ page }) => {
  await page.goto('/thjonusta')
  await expect(page.locator('html')).toHaveAttribute('lang', 'is')
  const nav = page.getByRole('navigation', { name: 'Aðalvalmynd' })
  await expect(nav.getByRole('link', { name: 'In English' })).toHaveAttribute(
    'href',
    '/en/services',
  )

  await page.goto('/en/services')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(
    page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Á íslensku' }),
  ).toHaveAttribute('href', '/thjonusta')
})

test('the language switch is a plain link that keeps the query', async ({ page }) => {
  await page.goto('/verkefni?forskodun=abc')
  await page.getByRole('link', { name: 'In English' }).click()
  await expect(page).toHaveURL(/\/en\/projects\?forskodun=abc$/)
  await page.getByRole('link', { name: 'Á íslensku' }).click()
  await expect(page).toHaveURL(/\/verkefni\?forskodun=abc$/)
})

test('the home page links to itself in both languages', async ({ page }) => {
  await page.goto('/en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const origin = new URL(page.url()).origin
  const link = (hreflang: string) => page.locator(`link[rel="alternate"][hreflang="${hreflang}"]`)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/en`)
  await expect(link('is')).toHaveAttribute('href', `${origin}/`)
  await expect(link('en')).toHaveAttribute('href', `${origin}/en`)
  await expect(link('x-default')).toHaveAttribute('href', `${origin}/`)
})

test('every host but berghald.is sends noindex', async ({ request }) => {
  for (const path of ['/', '/en/projects', '/sitemap.xml']) {
    const res = await request.get(path)
    expect(res.headers()['x-robots-tag']).toBe('noindex')
  }
})

test('the sitemap lists both languages with alternates', async ({ request }) => {
  const res = await request.get('/sitemap.xml')
  expect(res.headers()['content-type']).toContain('application/xml')
  const xml = await res.text()
  expect(xml).toMatch(/<loc>[^<]+\/en\/about<\/loc>/)
  expect(xml).toMatch(/hreflang="is" href="[^"]+\/um-okkur"/)
  expect(xml).not.toContain('takk-fyrir')
})

test('English pages fill untranslated fields from Icelandic, field by field', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'edits the shared about page')
  const save = (locale: string, data: Record<string, string>) =>
    request.put('/api/cms/admin/content/pages/about', { data: { locale, data } })
  expect((await save('is', { title: 'Um okkur', heading: 'Fjölskyldufyrirtæki' })).ok()).toBe(true)
  expect((await save('en', { title: 'About Berghald', heading: '' })).ok()).toBe(true)

  await page.goto('/en/about')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fjölskyldufyrirtæki')
  // Menu labels are each page's title.
  await expect(page.getByRole('link', { name: 'About Berghald' }).first()).toHaveAttribute(
    'href',
    '/en/about',
  )
})

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the menu folds into a button on phones and still opens', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout')
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Aðalvalmynd' })
    const projects = nav.getByRole('link', { name: 'Verkefni' })
    await expect(projects).toBeHidden()
    await nav.locator('summary').click()
    await expect(projects).toBeVisible()
  })
})
