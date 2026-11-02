import { expect, test } from '@playwright/test'
import { fail, installHost, pageState, reply } from './support'

const heading = "Sharlie couldn't start its background service"

test('a missing desktop bridge shows the service screen, not a blank window', async ({ page }) => {
  await page.goto('/')
  const alert = page.getByRole('alert')
  await expect(alert.getByRole('heading', { name: heading })).toBeVisible()
  await expect(alert.getByText('The desktop bridge did not load')).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Sharlie', exact: true })).toBeVisible()
  await expect(page.getByText('Loading the graph')).toHaveCount(0)
})

test('a failed state load shows the readable detail and Retry loads the app', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await fail(page, 'state', 'host process exited with code 1')
  const alert = page.getByRole('alert')
  await expect(alert.getByRole('heading', { name: heading })).toBeVisible()
  await expect(alert.getByText('host process exited with code 1')).toBeVisible()
  await alert.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('button', { name: 'Retrying' })).toBeDisabled()
  await reply(page, 'state', pageState())
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start learning' })).toBeVisible()
})

test('a bridge that throws synchronously still shows the service screen', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { sharlie: unknown }).sharlie = {
      state: () => {
        throw new Error('ipc channel closed')
      },
      action: () => Promise.reject(new Error('ipc channel closed')),
      lookup: () => Promise.reject(new Error('ipc channel closed')),
      onLearning: () => () => {},
    }
  })
  await page.goto('/')
  await expect(page.getByRole('alert').getByText('ipc channel closed')).toBeVisible()
  await expect(page.getByRole('alert').getByRole('heading', { name: heading })).toBeVisible()
})

test('Retry on the service screen is at least 44px tall', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await fail(page, 'state', 'host process exited with code 1')
  const box = await page.getByRole('button', { name: 'Retry' }).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
