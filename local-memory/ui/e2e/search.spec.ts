import { expect, test } from '@playwright/test'
import { fail, graphWithNodes, lastCall, openApp, pageState, reply } from './support'

const retryLabel = '[data-graph-label="card:retry"]'
const viteLabel = '[data-graph-label="tool:vite"]'

test('search stays usable through a lookup, an error, and a second lookup', async ({ page }) => {
  await openApp(page, pageState())
  const search = page.getByLabel('Search')
  await search.fill('retry')
  await expect(page.getByRole('heading', { name: 'Sharlie', exact: true })).toBeVisible()
  await search.press('Enter')
  await expect(page.getByText('Looking up')).toBeVisible()
  await reply(page, 'lookup', { answer: 'Retry the deploy once.' })
  await expect(page.getByText('Retry the deploy once.')).toBeVisible()
  await expect(page.getByText('Looking up')).toHaveCount(0)
  await expect(search).toBeEnabled()

  await search.press('Enter')
  await expect(page.getByText('Looking up')).toBeVisible()
  await expect(page.getByText('Retry the deploy once.')).toHaveCount(0)
  await fail(page, 'lookup', 'Lookup failed')
  await expect(page.getByText('Lookup failed')).toBeVisible()
  await expect(page.getByText('Looking up')).toHaveCount(0)
  await expect(search).toBeEnabled()
})

test('typing retry hides vite and does not call lookup', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const search = page.getByLabel('Search')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toBeVisible()
  await search.fill('retry')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toHaveCount(0)
  expect(await lastCall(page, 'lookup')).toBeNull()
})

test('clearing the search field shows both labels again', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const search = page.getByLabel('Search')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toBeVisible()
  await search.fill('retry')
  await expect(page.locator(viteLabel)).toHaveCount(0)
  await search.fill('')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toBeVisible()
})

test('typing RETRY still hides vite', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const search = page.getByLabel('Search')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toBeVisible()
  await search.fill('RETRY')
  await expect(page.locator(retryLabel)).toBeVisible()
  await expect(page.locator(viteLabel)).toHaveCount(0)
})

test('enter looks up the typed query and shows the answer', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const search = page.getByLabel('Search')
  await expect(page.locator(retryLabel)).toBeVisible()
  await search.fill('retry')
  await search.press('Enter')
  await expect(page.getByText('Looking up')).toBeVisible()
  expect((await lastCall(page, 'lookup'))?.payload).toBe('retry')
  await reply(page, 'lookup', { answer: 'Retry the deploy once.' })
  await expect(page.getByText('Retry the deploy once.')).toBeVisible()
  await expect(page.getByText('Looking up')).toHaveCount(0)
})
