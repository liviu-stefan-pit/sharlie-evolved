import { expect, test } from '@playwright/test'
import { fail, graphWithNodes, openApp, pageState, reply } from './support'

test('start learning stays disabled without a key and recovers after a failure', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false, keyMask: '' }))
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Add a key in Settings.')).toBeVisible()
})

test('start learning disables while it runs and leaves after cards exist', async ({ page }) => {
  await openApp(page, pageState())
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(button).toBeDisabled()
  await fail(page, 'action', 'Could not start learning')
  await expect(button).toBeEnabled()
  await expect(page.getByText('Could not start learning')).toBeVisible()

  await button.click()
  await expect(button).toBeDisabled()
  const learned = pageState({ graph: graphWithNodes() })
  await reply(page, 'action', learned)
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await expect(page.locator('[data-graph]')).toBeVisible()
})
