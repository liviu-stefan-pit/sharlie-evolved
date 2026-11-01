import { expect, test } from '@playwright/test'
import { clickNode, graphWithNodes, openApp, pageState } from './support'

test('a node opens one drawer, a chip replaces it, and Close removes it', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await clickNode(page, 'card:retry')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await expect(page.getByText('Retry once')).toBeVisible()
  await expect(page.getByText('lock')).toBeVisible()

  await page.getByRole('button', { name: 'APPLIES_TO vite' }).click()
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'vite' })).toBeVisible()

  await clickNode(page, 'card:retry')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('aside')).toHaveCount(0)
})
