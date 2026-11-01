import { expect, test } from '@playwright/test'
import { openApp, pageState } from './support'

test('the window uses the open dark palette', async ({ page }) => {
  await openApp(page, pageState())
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(31, 31, 31)')
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(204, 204, 204)')
  await page.getByRole('button', { name: 'Settings' }).click()
  const save = page.getByRole('button', { name: 'Save' })
  await expect(save).toHaveCSS('background-color', 'rgb(0, 120, 212)')
  await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)')
  const html = (await page.content()).toLowerCase()
  expect(html).not.toContain('#131314')
  expect(html).not.toContain('#09090b')
  expect(html).not.toContain('#f4f4f5')
})
