import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { graphWithNodes, lastCall, openApp, pageState } from './support'
import type { PageState } from '../src/types'

const real = JSON.parse(readFileSync(new URL('./fixtures/real-host.json', import.meta.url), 'utf8')) as Record<string, PageState>

async function fits(page: Page, label: string) {
  const field = page.getByLabel(label)
  return field.evaluate((el) => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth)
}

// (A) The email was not lost, it was clipped: three equal columns left the field too narrow for "liviu@example.com".
for (const width of [1280, 390]) {
  test(`first-run Email shows liviu@example.com without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openApp(page, pageState({ profile: { username: 'liviu', email: 'liviu@example.com', team: 'platform' }, graph: { nodes: [], links: [] } as PageState['graph'] }))
    await expect(page.getByLabel('Email')).toHaveValue('liviu@example.com')
    expect(await fits(page, 'Email')).toBe(true)
  })
  test(`Settings Email shows liviu@example.com without clipping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openApp(page, pageState({ profile: { username: 'liviu', email: 'liviu@example.com', team: 'platform' } }))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    expect(await fits(page, 'Email')).toBe(true)
  })
}

// (B) Real card from the host (real-host.json 08-finished): failure_modes = [situation, why, apply] (src/app.ts publishCard).
test('real lesson: What went wrong lists only the situation; why and apply have their own sections', async ({ page }) => {
  const card = real['08-finished']!.graph.nodes.find((node) => node.kind === 'card')!
  expect(card.failure_modes).toHaveLength(3)
  await openApp(page, structuredClone(real['08-finished']!))
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByRole('button', { name: 'Retry the deploy once' }).first().click()
  const section = (name: string) => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await expect(section('What to do')).toContainText('Retry the deploy once, then read the log.')
  await expect(section('Why it works')).toContainText('The lock clears on its own within a minute.')
  await expect(section('When to use it')).toContainText('When a deploy fails on a lock, retry once before changing config.')
  const wrong = section('What went wrong').locator('li')
  await expect(wrong).toHaveCount(1)
  await expect(wrong).toContainText('the lock was held')
})

test('a one-line failure_modes (older card) stays under What went wrong', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByRole('button', { name: 'Retry the deploy' }).first().click()
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'What went wrong' }) }).locator('li')).toHaveText(['lock'])
  await expect(page.getByRole('heading', { name: 'When to use it' })).toHaveCount(0)
})

// Steering (1): 360px header keeps a usable Ask field; Enter asks.
test('360px header: Ask field says "Ask", fits beside Sources and Settings, and Enter asks', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await expect(ask).toHaveAttribute('placeholder', 'Ask')
  const box = (await ask.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(60)
  const settings = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
  expect(settings.x + settings.width).toBeLessThanOrEqual(360)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await ask.fill('how do I retry a deploy?')
  await ask.press('Enter')
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'lookup'))
  expect((await lastCall(page, 'lookup'))?.payload).toBe('how do I retry a deploy?')
})

test('wide header keeps "Ask Sharlie" and the Ask button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.getByRole('textbox', { name: 'Ask Sharlie' })).toHaveAttribute('placeholder', 'Ask Sharlie')
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeVisible()
})

// Steering (2): unavailable sharing sits right under the switch label, without the long how-it-works copy.
for (const shareAvailable of [false, undefined]) {
  test(`Team sharing card, shareAvailable ${String(shareAvailable)}: unavailable line under the label, long copy hidden`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await openApp(page, pageState({ shareAvailable, share: false }))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const toggle = page.getByRole('switch', { name: "Share work lessons with my team's Drive folder" })
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAccessibleDescription("Team sharing isn't available in this version. Your lessons stay on this PC.")
    await expect(page.getByText("Team sharing isn't available in this version. Your lessons stay on this PC.")).toHaveCount(1)
    await expect(page.getByText('Only lessons from work projects are copied.', { exact: false })).toHaveCount(0)
  })
}

test('Team sharing card with sharing available keeps the explanation', async ({ page }) => {
  await openApp(page, pageState({ shareAvailable: true, share: false }))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByText('Only lessons from work projects are copied.', { exact: false })).toBeVisible()
})
