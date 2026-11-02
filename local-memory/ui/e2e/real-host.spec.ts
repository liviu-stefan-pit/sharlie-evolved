import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { lastCall, openApp, reply } from './support'
import type { PageState } from '../src/types'

// Snapshots captured from the real host on main (src/window.ts) by /workspace/nova/sharlie-shots/realhost/drive2.mts,
// paths rewritten to Windows form. Each key is one step of a real run.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-host.json', import.meta.url), 'utf8')) as Record<string, PageState>
const snap = (key: string, overrides: Partial<PageState> = {}) => ({ ...structuredClone(real[key]!), ...overrides })
const status = (page: Page) => page.locator('header [role="img"]')

async function nextAction(page: Page) {
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  return (await lastCall(page, 'action'))?.payload
}
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
}
const toggle = (page: Page) => page.getByRole('switch', { name: "Share work lessons with my team's Drive folder" })

test('real fresh snapshot: not set up, no schedule claimed', async ({ page }) => {
  await openApp(page, snap('01-fresh'))
  expect(real['01-fresh']!.scheduled).toBe(false)
  await expect(status(page)).toHaveAccessibleName('Not set up yet')
})

test('real snapshot after the key: scheduled true and cadence 30m reads "Learns every 30 minutes"', async ({ page }) => {
  expect(real['02-recheck']!.scheduled).toBe(false)
  expect(real['06b-state']!.scheduled).toBe(true)
  await openApp(page, snap('06b-state'))
  await expect(status(page)).toHaveAccessibleName('Learns every 30 minutes')
})

test('real finished pass: host lastLearnedAt drives the status line', async ({ page }) => {
  await openApp(page, snap('08-finished'))
  await expect(status(page)).toHaveAccessibleName(/^Learns every 30 minutes · last learned /)
})

test('real finished pass without a schedule says Last learned, never a cadence', async ({ page }) => {
  await openApp(page, snap('08-finished', { scheduled: false }))
  await expect(status(page)).toHaveAccessibleName(/^Last learned /)
})

test('real manual cadence keeps "Learns when you ask"', async ({ page }) => {
  await openApp(page, snap('19-cadence-manual'))
  await expect(status(page)).toHaveAccessibleName(/^Learns when you ask · last learned /)
})

test('real rerun with nothing new (learning null, 0 of 0 result) says Nothing new to learn', async ({ page }) => {
  await openApp(page, snap('08-finished'))
  await page.getByRole('button', { name: /^Learn now/ }).click()
  await reply(page, 'action', snap('09-rerun'))
  await expect(page.getByText('Nothing new to learn')).toBeVisible()
  await expect(page.getByText('6 lessons learned')).toHaveCount(0)
})

test('real Team sharing: the switch is live, cancel saves nothing, a folder then turns sharing on', async ({ page }) => {
  await openApp(page, snap('08-finished'))
  await openSettings(page)
  await expect(page.getByText("Team sharing isn't available in this version yet")).toHaveCount(0)
  await expect(toggle(page)).toBeEnabled()
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  // No folder yet: the switch opens the folder picker first.
  await toggle(page).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'share' })
  await reply(page, 'action', snap('11-pick-cancel'))
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  await toggle(page).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'share' })
  await reply(page, 'action', snap('13-pick-team'))
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'true' })
  await reply(page, 'action', snap('14-share-on'))
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Sharing to G:\\My Drive\\Team')).toBeVisible()
  await expect(page.getByText('✓ Saved')).toBeVisible()
  await expect(page.getByText('Next to share: 6 lessons')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Next to share' }).locator('li')).toHaveCount(3)
})

test('real Change folder cancelled (host returns the same folder) shows no Saved', async ({ page }) => {
  await openApp(page, snap('14-share-on'))
  await openSettings(page)
  await page.getByRole('button', { name: 'Change folder' }).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'share' })
  await reply(page, 'action', snap('14-share-on', { notice: '' }))
  await page.waitForTimeout(100)
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
})

test('real missing folder refusal shows the host sentence, no Saved, sharing stays off', async ({ page }) => {
  await openApp(page, snap('08-finished'))
  await openSettings(page)
  await toggle(page).click()
  await reply(page, 'action', snap('12-pick-missing'))
  await expect(page.getByText('That folder does not exist.')).toBeVisible()
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
})

test('real after publish: last shared time, no Next to share; off keeps the folder', async ({ page }) => {
  await openApp(page, snap('16-after-publish'))
  await openSettings(page)
  await expect(page.getByText(/· last shared \d\d:\d\d/)).toBeVisible()
  await expect(page.getByRole('list', { name: 'Next to share' })).toHaveCount(0)
  await toggle(page).click()
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'false' })
  await reply(page, 'action', snap('17-share-off'))
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('Not sharing. Everything stays on this PC.')).toBeVisible()
})

for (const [key, badge] of [
  ['08-finished', 'Only on this PC'],
  ['14-share-on', 'Waiting to share'],
  ['16-after-publish', 'Shared'],
] as const) {
  test(`real ${key} card scope/synced shows "${badge}" in the lesson`, async ({ page }) => {
    await openApp(page, snap(key))
    await page.getByRole('button', { name: 'List' }).click()
    await page.getByRole('button', { name: 'Retry the deploy once' }).first().click()
    await expect(page.getByText(badge, { exact: true })).toBeVisible()
  })
}
