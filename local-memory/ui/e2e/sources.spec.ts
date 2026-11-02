import { expect, test } from '@playwright/test'
import { openApp, pageState } from './support'

test('the sources menu opens, lists folders, and closes again', async ({ page }) => {
  await openApp(page, pageState())
  const button = page.getByRole('button', { name: 'Sources' })
  await button.click()
  const menu = page.getByRole('menu', { name: 'Sources' })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Cursor', { exact: true })).toBeVisible()
  await expect(menu.getByText('C:\\Users\\ada\\.cursor')).toBeVisible()
  await button.click()
  await expect(menu).toBeHidden()
})

test('the sources menu closes on Escape, an outside click, and Settings', async ({ page }) => {
  await openApp(page, pageState())
  const button = page.getByRole('button', { name: 'Sources' })
  await button.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Sources' })).toBeHidden()

  await button.click()
  await page.getByRole('heading', { name: 'Sharlie', exact: true }).click()
  await expect(page.getByRole('menu', { name: 'Sources' })).toBeHidden()

  await button.click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('menu', { name: 'Sources' })).toBeHidden()
  await expect(page.getByLabel('Username')).toBeVisible()
})

test('an empty source list stays open as an empty message', async ({ page }) => {
  await openApp(page, pageState({ sources: [] }))
  await page.getByRole('button', { name: 'Sources' }).click()
  await expect(page.getByRole('menu', { name: 'Sources' })).toBeVisible()
  await expect(page.getByText('No source folders')).toBeVisible()
})

test('source rows are not buttons', async ({ page }) => {
  await openApp(page, pageState())
  await page.getByRole('button', { name: 'Sources' }).click()
  const menu = page.getByRole('menu', { name: 'Sources' })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Cursor', { exact: true })).toBeVisible()
  await expect(menu.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sources' })).toHaveCount(1)
})
