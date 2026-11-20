import { expect, test } from '@playwright/test'

/** The local D1 persists between runs, so every item gets a name no other run uses. */
const tag = () => crypto.randomUUID().slice(0, 8)

test('a project saves services, work period, year and rich text, and gets a slug', async ({
  page,
}) => {
  const id = tag()
  const service = `Hellulögn ${id}`
  await page.goto('/vefstjorn/services')
  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(service)
  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByText('Vistað')).toBeVisible()

  const title = `Garður í Garðabæ ${id}`
  await page.goto('/vefstjorn/projects')
  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(title)
  await page.getByRole('group', { name: 'Þjónusta' }).getByLabel(service).check()
  const period = page.getByRole('group', { name: 'Verktími' })
  await period.getByLabel('Frá').selectOption({ label: 'maí' })
  await period.getByLabel('Til').selectOption({ label: 'ágúst' })
  await page.getByLabel('Ár').fill('2024')

  const body = page.getByRole('textbox', { name: 'Texti' })
  await body.click()
  await body.pressSequentially('Steyptar tröppur')
  await body.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Feitletrað' }).click()

  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByText('Vistað')).toBeVisible()
  await expect(page.getByText(`gardur-i-gardabae-${id}`)).toBeVisible()

  // Open it again from the list: everything comes back as saved.
  await page.reload()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('group', { name: 'Þjónusta' }).getByLabel(service)).toBeChecked()
  await expect(period.getByLabel('Frá')).toHaveValue('5')
  await expect(period.getByLabel('Til')).toHaveValue('8')
  await expect(page.getByLabel('Ár')).toHaveValue('2024')
  await expect(body.locator('strong')).toHaveText('Steyptar tröppur')
})

test('Vefstjórn flags a year that is not a number and an invalid email', async ({ page }) => {
  await page.goto('/vefstjorn/projects')
  await page.getByRole('button', { name: 'Nýtt' }).click()
  await page.getByLabel('Heiti').fill(`Prófun ${tag()}`)
  await page.getByLabel('Ár').fill('í fyrra')
  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByText('Ógilt gildi.')).toBeVisible()

  await page.goto('/vefstjorn/settings')
  await page.getByLabel('Netfang').fill('berghald.is')
  await page.getByRole('button', { name: 'Vista' }).click()
  await expect(page.getByText('Sláðu inn gilt netfang')).toBeVisible()
})
