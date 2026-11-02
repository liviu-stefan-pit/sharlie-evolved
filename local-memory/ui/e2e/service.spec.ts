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
  // Raw text only: no sentence of its own, the guidance line, and the raw text under Details.
  await expect(alert.getByText('Retry below. If it keeps failing')).toBeVisible()
  await expect(alert.getByText('host process exited with code 1')).toHaveCount(0)
  await alert.getByRole('button', { name: 'Details' }).click()
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
  await page.getByRole('alert').getByRole('button', { name: 'Details' }).click()
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

const packed =
  "Error invoking remote method 'state': Error: Sharlie couldn't read its settings file at C:\\Users\\ada\\.sharlie\\knowledge\\settings.json. Fix or remove that file, then press Retry. (Unexpected token / in JSON at position 4 (line 2 column 3) C:\\Users\\ada\\.sharlie\\knowledge\\" + 'x'.repeat(160) + ')'

for (const width of [360, 768, 1280]) {
  test(`a host startup sentence shows alone, with the raw text under a collapsed Details at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await installHost(page)
    await page.goto('/')
    await fail(page, 'state', packed)
    const alert = page.getByRole('alert')
    const sentence = alert.getByText("Sharlie couldn't read its settings file at", { exact: false })
    await expect(sentence).toBeVisible()
    await expect(sentence).not.toContainText('Unexpected token')
    await expect(sentence).not.toContainText('Error invoking remote method')
    await expect(sentence).toHaveCSS('color', 'rgb(230, 232, 238)')
    // The sentence already says to press Retry, so the generic line is not repeated.
    await expect(alert.getByText('Retry below. If it keeps failing')).toHaveCount(0)
    const details = alert.getByRole('button', { name: 'Details' })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(alert.getByText('Unexpected token', { exact: false })).toHaveCount(0)
    expect((await details.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(36)
    await details.focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    const raw = alert.locator('pre')
    await expect(raw).toContainText('Unexpected token / in JSON at position 4 (line 2 column 3)')
    await expect(raw).toHaveCSS('font-family', /mono/i)
    await expect(raw).toHaveCSS('color', 'rgb(163, 169, 184)')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    const box = await raw.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    await page.keyboard.press('Enter')
    await expect(details).toHaveAttribute('aria-expanded', 'false')
  })
}

test('a plain sentence with no raw detail shows no Details control', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await fail(page, 'state', 'Sharlie host is not available')
  const alert = page.getByRole('alert')
  await expect(alert.getByText('Sharlie host is not available')).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Details' })).toHaveCount(0)
  await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible()
})
