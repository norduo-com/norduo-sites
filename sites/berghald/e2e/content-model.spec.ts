import { expect, type Page, test } from '@playwright/test'

/** The e2e D1 is shared by the projects of a run, so every name is one no other test uses. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

async function save(page: Page) {
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')
}

test('every collection opens in Vefstjórn and saves a new item', async ({ page }) => {
  await page.goto('/vefstjorn/projects')
  await page.getByRole('link', { name: 'Nýtt', exact: true }).click()
  await expect(page).toHaveURL(/\/vefstjorn\/projects\/_new$/)
  await page.getByLabel('Heiti').fill(unique('Verkefni'))
  await save(page)

  await page.goto('/vefstjorn/services')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByLabel('Heiti').fill(unique('Þjónusta'))
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  // A service needs at least one season.
  await expect(page.getByText('Þennan reit þarf að fylla út.', { exact: true })).toBeVisible()
  await page.getByRole('group', { name: 'Árstíðir', exact: true }).getByLabel('Vor').check()
  await save(page)

  for (const [path, name] of [
    ['team', 'Nafn'],
    ['equipment', 'Heiti'],
  ] as const) {
    await page.goto(`/vefstjorn/${path}`)
    await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
    await page.getByLabel(name).fill(unique('Prófun'))
    await save(page)
  }
})

test('every page and singleton opens in Vefstjórn and saves', async ({ page }) => {
  // pages.spec edits the home page; this one leaves it alone so the two can't race.
  // The titles are the menu labels, which other tests look for.
  const pages = {
    services: 'Þjónusta',
    projects: 'Verkefni',
    about: 'Um okkur',
    thankYou: 'Takk fyrir',
    privacy: 'Persónuverndarstefna',
    cookies: 'Vafrakökur',
    notFound: 'Síða fannst ekki',
  }
  for (const [name, label] of Object.entries(pages)) {
    await page.goto(`/vefstjorn/pages/${name}`)
    const title = page.getByRole('textbox', { name: 'Heiti', exact: true })
    if ((await title.inputValue()) === '') await title.fill(label)
    await save(page)
  }
  // The cookie table is written in code, and the page says so.
  await page.goto('/vefstjorn/pages/cookies')
  await expect(
    page.getByRole('complementary', { name: 'Ekki breytanlegt hér', exact: true }),
  ).toContainText('vafrakökutaflan')

  await page.goto('/vefstjorn/pages/footer')
  await save(page)

  await page.goto('/vefstjorn/settings')
  await expect(
    page.getByRole('complementary', { name: 'Ekki breytanlegt hér', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Fyrirtæki').fill('Berghald ehf.')
  await page.getByLabel('Sími').fill('691 8944')
  await page.getByLabel('Netfang').fill('berghald@example.com')
  await page.getByLabel('Facebook').fill('https://facebook.com/berghald')
  await save(page)
})

test('a repeater adds, reorders and removes items, and they save', async ({ page }) => {
  const name = unique('Hellulögn')
  await page.goto('/vefstjorn/services')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByLabel('Heiti').fill(name)
  await page.getByRole('group', { name: 'Árstíðir', exact: true }).getByLabel('Sumar').check()

  const items = page.getByRole('group', { name: 'Atriði', exact: true })
  for (const text of ['Hellulögn', 'Snjóbræðsla']) {
    await items.getByRole('button', { name: 'Bæta við í „Atriði“', exact: true }).click()
    await items.getByRole('region').last().getByRole('textbox').fill(text)
  }
  await items.getByRole('button', { name: 'Færa Atriði 2 upp', exact: true }).click()
  await expect(
    items.getByRole('button', { name: 'Færa Atriði 1 niður', exact: true }),
  ).toBeFocused()
  await save(page)

  await page.reload()
  await page.getByRole('button', { name: new RegExp(name) }).click()
  const region = (n: number) =>
    items.getByRole('region', { name: `Atriði ${String(n)}`, exact: true })
  await expect(region(1).getByRole('textbox')).toHaveValue('Snjóbræðsla')
  await expect(region(2).getByRole('textbox')).toHaveValue('Hellulögn')

  await items.getByRole('button', { name: 'Fjarlægja Atriði 1', exact: true }).click()
  await expect(items.getByRole('region')).toHaveCount(1)
  await expect(region(1).getByRole('textbox')).toHaveValue('Hellulögn')
})

test('Þjónusta says which season it is and tags each service with its seasons', async ({
  page,
}) => {
  const name = unique('Snjómokstur')
  await page.goto('/vefstjorn/services')
  await expect(page.getByText(/^Nú er (vetur|vor|sumar|haust)\./)).toBeVisible()
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByLabel('Heiti').fill(name)
  const seasons = page.getByRole('group', { name: 'Árstíðir', exact: true })
  await seasons.getByLabel('Vetur').check()
  await seasons.getByLabel('Haust').check()
  await save(page)
  const row = page.getByRole('button', { name: new RegExp(name) })
  await expect(row).toContainText('Vetur')
  await expect(row).toContainText('Haust')
})

test('Verkefni warns when more than four published projects are on the home page', async ({
  page,
}) => {
  for (let i = 0; i < 5; i++) {
    const res = await page.request.post('/api/cms/admin/content/projects', {
      data: { status: 'published', data: { title: unique('Á forsíðu'), showOnHome: true } },
    })
    expect(res.status()).toBe(201)
  }
  await page.goto('/vefstjorn/projects')
  const warning = page.getByRole('list', { name: 'Athugið', exact: true })
  await expect(warning).toContainText('Fleiri en fjögur birt verkefni')
  // The table opens each project on its own page, where the warning stays in view.
  await page
    .getByRole('link', { name: /^Á forsíðu/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/vefstjorn\/projects\/[0-9a-f-]{36}$/)
  await expect(warning).toContainText('Fleiri en fjögur birt verkefni')
})
