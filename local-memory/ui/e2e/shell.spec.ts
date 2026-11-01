import { expect, test } from '@playwright/test'
import { clickNode, fail, graphWithNodes, installHost, openApp, pageState, reply } from './support'

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

test('a running harvest mark uses the synced color', async ({ page }) => {
  await openApp(page, pageState({ paused: false }))
  const mark = page.getByLabel('Harvest running')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveCSS('background-color', 'rgb(111, 143, 120)')
})

test('a paused harvest mark uses the pending color', async ({ page }) => {
  await openApp(page, pageState({ paused: true }))
  const mark = page.getByLabel('Harvest paused')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveCSS('background-color', 'rgb(184, 154, 106)')
})

test('the open drawer is 280 wide and stays inside the window', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await clickNode(page, 'card:retry')
  const box = await page.locator('aside').boundingBox()
  if (!box) throw new Error('drawer is missing')
  expect(Math.abs(box.width - 280)).toBeLessThanOrEqual(1)
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(680)
  expect(box.y + box.height).toBeLessThanOrEqual(520)
})
