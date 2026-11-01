import { expect, test } from '@playwright/test'
import { fail, installHost, openApp, pageState, reply } from './support'

test('the header stays up while the page loads, errors, and switches views', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sharlie' })).toBeVisible()
  await expect(page.getByLabel('Search')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sources' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Loading the graph')).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Loading the graph')).toBeVisible()
  await expect(page.getByLabel('Username')).toHaveCount(0)

  await reply(page, 'state', pageState())
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByText('Loading the graph')).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('Username')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start learning' })).toBeVisible()
})

test('a host error stays on screen when Settings is pressed', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await fail(page, 'state', 'Sharlie host is not available')
  await expect(page.getByText('Sharlie host is not available')).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Sharlie host is not available')).toBeVisible()
  await expect(page.getByLabel('Username')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sources' })).toBeVisible()
})

test('settings opens over a loaded graph without a blank frame', async ({ page }) => {
  await openApp(page, pageState())
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('Username')).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Username')).toHaveCount(0)
  await expect(page.locator('[data-graph]')).toBeVisible()
})
