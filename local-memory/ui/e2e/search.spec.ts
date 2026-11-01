import { expect, test } from '@playwright/test'
import { fail, openApp, pageState, reply } from './support'

test('search stays usable through a lookup, an error, and a second lookup', async ({ page }) => {
  await openApp(page, pageState())
  const search = page.getByLabel('Search')
  await search.fill('retry')
  await expect(page.getByRole('heading', { name: 'Sharlie' })).toBeVisible()
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
