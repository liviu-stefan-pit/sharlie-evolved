import { expect, test } from '@playwright/test'
import { fail, openApp, pageState, reply } from './support'

async function settings(page: import('@playwright/test').Page) {
  await openApp(page, pageState())
  await page.getByRole('button', { name: 'Settings' }).click()
}

test('settings keeps every control, including the model row', async ({ page }) => {
  await settings(page)
  await expect(page.getByLabel('Username')).toHaveValue('ada')
  await expect(page.getByLabel('Email')).toHaveValue('ada@example.com')
  await expect(page.getByLabel('Team')).toHaveValue('platform')
  await expect(page.getByLabel('Provider')).toHaveValue('cursor')
  await expect(page.getByLabel('Key')).toBeVisible()
  await expect(page.getByLabel('Model')).toBeEnabled()
  await expect(page.getByLabel('Model')).toHaveValue('composer')
  await expect(page.getByLabel('Local vault')).toHaveValue('C:\\vault')
  await expect(page.getByLabel('Auto-drop')).not.toBeChecked()
  await expect(page.getByLabel('Folder')).toHaveValue('C:\\drive')
  await expect(page.getByLabel('Harvest cadence')).toHaveValue('30m')
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()

  await page.getByLabel('Provider').selectOption('copilot')
  await expect(page.getByLabel('Model')).toBeVisible()
  await expect(page.getByLabel('Model')).toBeDisabled()
})

test('show and hide return the key field to a password', async ({ page }) => {
  await settings(page)
  const key = page.getByLabel('Key')
  await expect(key).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show' }).click()
  await reply(page, 'reveal-key', { secret: 'sk-live-key' })
  await expect(key).toHaveAttribute('type', 'text')
  await expect(key).toHaveValue('sk-live-key')
  await page.getByRole('button', { name: 'Hide' }).click()
  await expect(key).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Show' })).toBeVisible()
})

test('a failed reveal leaves the key hidden', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Show' }).click()
  await fail(page, 'reveal-key', 'Could not show the key')
  await expect(page.getByText('Could not show the key')).toBeVisible()
  await expect(page.getByLabel('Key')).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Show' })).toBeEnabled()
})

test('save returns to an enabled Save after success and after failure', async ({ page }) => {
  await settings(page)
  const save = page.getByRole('button', { name: 'Save' })
  await page.getByLabel('Team').fill('labs')
  await save.click()
  await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled()
  await reply(page, 'action', pageState())
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()

  await page.getByLabel('Team').fill('other')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Saving' })).toBeDisabled()
  await fail(page, 'action', 'Could not save settings')
  await expect(page.getByText('Could not save settings')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
})
