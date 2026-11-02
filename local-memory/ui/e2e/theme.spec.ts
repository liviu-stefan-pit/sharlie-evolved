import { expect, test } from '@playwright/test'
import { openApp, pageState } from './support'

test('the window uses the Lyra dark palette', async ({ page }) => {
  await openApp(page, pageState())
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 22, 28)')
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(230, 232, 238)')
  await page.getByRole('button', { name: 'Settings' }).click()
  const save = page.getByRole('button', { name: 'Save' })
  await expect(save).toHaveCSS('background-color', 'rgb(0, 120, 212)')
  await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(page.locator('body')).toHaveCSS('font-size', '15px')
  const html = (await page.content()).toLowerCase()
  expect(html).not.toContain('#131314')
  expect(html).not.toContain('#09090b')
  expect(html).not.toContain('#f4f4f5')
})

test('a light system theme switches to the light palette', async ({ page }) => {
  await openApp(page, pageState())
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 244, 239)')
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(29, 34, 48)')
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCSS('background-color', 'rgb(0, 95, 184)')
})

test('focus shows a 2px ring with a 2px offset', async ({ page }) => {
  await openApp(page, pageState())
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toHaveCSS('outline-width', '2px')
  await expect(focused).toHaveCSS('outline-offset', '2px')
  await expect(focused).toHaveCSS('outline-color', 'rgb(61, 155, 255)')
})
