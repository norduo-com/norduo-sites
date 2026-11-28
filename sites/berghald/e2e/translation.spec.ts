import { expect, test } from '@playwright/test'

/** The local D1 persists between runs, so every item gets a name no other run uses. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`

// Local builds use the fake translator (TRANSLATOR=fake): "[en] <Icelandic>".
test('saving Icelandic fills the English as Óyfirfarið; editing the English clears it', async ({
  page,
}) => {
  const name = unique('Kranabíll')
  await page.goto('/vefstjorn/equipment')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Enska', exact: true })).toBeDisabled()
  await page.getByLabel('Heiti').fill(name)
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')

  const english = page.getByRole('tabpanel', { name: 'Enska', exact: true })
  // The translation runs after the save; reopening the tab loads the latest.
  await expect(async () => {
    await page.getByRole('tab', { name: 'Íslenska', exact: true }).click()
    await page.getByRole('tab', { name: 'Enska', exact: true }).click()
    await expect(english.getByRole('textbox', { name: 'Heiti', exact: true })).toHaveValue(
      `[en] ${name}`,
      {
        timeout: 1000,
      },
    )
  }).toPass()
  await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(1)

  await english.getByRole('textbox', { name: 'Heiti', exact: true }).fill('Crane truck')
  await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(0)
  await english.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(english.getByRole('status')).toHaveText('Vistað')
  await expect(english.getByRole('textbox', { name: 'Heiti', exact: true })).toHaveValue(
    'Crane truck',
  )
  await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(0)

  // Still clear after reopening: the server stored it as reviewed.
  await page.getByRole('tab', { name: 'Íslenska', exact: true }).click()
  await page.getByRole('tab', { name: 'Enska', exact: true }).click()
  await expect(english.getByRole('textbox', { name: 'Heiti', exact: true })).toHaveValue(
    'Crane truck',
  )
  await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(0)
})

test('approving a machine translation clears Óyfirfarið without changing it', async ({ page }) => {
  const name = unique('Smágrafa')
  await page.goto('/vefstjorn/equipment')
  await page.getByRole('button', { name: 'Nýtt', exact: true }).click()
  await page.getByLabel('Heiti').fill(name)
  await page.getByRole('button', { name: 'Vista', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Vistað')

  const english = page.getByRole('tabpanel', { name: 'Enska', exact: true })
  await expect(async () => {
    await page.getByRole('tab', { name: 'Íslenska', exact: true }).click()
    await page.getByRole('tab', { name: 'Enska', exact: true }).click()
    await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(1, { timeout: 1000 })
  }).toPass()
  await english.getByRole('button', { name: 'Samþykkja þýðingu á „Heiti“', exact: true }).click()
  await expect(english.getByRole('status')).toHaveText('Þýðing samþykkt')
  await expect(english.getByText('Óyfirfarið', { exact: true })).toHaveCount(0)
  await expect(english.getByRole('textbox', { name: 'Heiti', exact: true })).toHaveValue(
    `[en] ${name}`,
  )
})
