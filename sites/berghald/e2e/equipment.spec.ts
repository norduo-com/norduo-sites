import { expect, type Page, test } from '@playwright/test'

/** The local D1 persists between runs, so every item gets a name no other run uses. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

async function addEquipment(page: Page, name: string, status: 'Drög' | 'Birt') {
  await page.goto('/vefstjorn/equipment')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByLabel('Heiti').fill(name)
  await page.getByLabel('Lýsing').fill('Prófun')
  await page.getByRole('radio', { name: status }).check()
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')
  await expect(page.getByRole('button', { name: new RegExp(name) })).toContainText(status)
}

test('an item saved as Birt shows on the public site; Drög does not', async ({ page }) => {
  const published = unique('Kranabíll')
  const draft = unique('Smágrafa')
  await addEquipment(page, published, 'Birt')
  await addEquipment(page, draft, 'Drög')

  await page.goto('/')
  const list = page.getByRole('region', { name: 'Tækin okkar', exact: true })
  await expect(list.getByRole('heading', { name: published })).toBeVisible()
  await expect(list.getByRole('heading', { name: draft })).toHaveCount(0)
})

test('Vefstjórn refuses to save an item without a name', async ({ page }) => {
  await page.goto('/vefstjorn/equipment')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByText('Þennan reit þarf að fylla út.', { exact: true })).toBeVisible()
})

test('deleting an item removes it from the public site', async ({ page }) => {
  const name = unique('Vörubíll')
  await addEquipment(page, name, 'Birt')
  await page.getByRole('button', { name: 'Eyða', exact: true }).click()
  await page.getByRole('button', { name: 'Já, eyða', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toHaveCount(0)

  await page.goto('/')
  await expect(page.getByRole('heading', { name })).toHaveCount(0)
})
