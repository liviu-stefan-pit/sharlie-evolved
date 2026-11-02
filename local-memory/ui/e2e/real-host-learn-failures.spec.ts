import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { emitLearning, lastCall, openApp, reply } from './support'
import type { PageState } from '../src/types'

// Real Learn now failures captured from the host on main (84fcd42) by
// /workspace/nova/sharlie-shots/realhost/drive4.mts (SCENARIO=key-missing | secret-missing | model-error), paths rewritten
// to Windows form. Each scenario first ran a real pass (2 lessons), then broke one thing and pressed Learn now:
//   key-missing: clear-provider (key saved, no provider on) -> refused key_missing
//   secret-missing: the vault secret deleted -> refused secret_missing
//   model-error: the lesson writer throws "model timed out" -> a pass runs, then ends with model_error
// "-start" is the start-learning reply, "-after" the state once the pass settled.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-host-learn-failures.json', import.meta.url), 'utf8')) as Record<string, PageState> & {
  _meta: Record<string, { settingsLastLearnedAt: string }>
}
const snap = (key: string) => structuredClone(real[key]!)
const status = (page: Page) => page.locator('header [role="img"]')
const strip = (page: Page) => page.locator('section').filter({ has: page.getByRole('status') }).first()

async function learnNow(page: Page) {
  await page.getByRole('button', { name: /^Learn now/ }).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  expect((await lastCall(page, 'action'))?.payload).toEqual({ action: 'start-learning' })
}

for (const name of ['key-missing', 'secret-missing', 'model-error']) {
  test(`real ${name}: the host keeps lastLearnedAt and sends learning.error with errorCode`, () => {
    const before = real[`${name}-before`]!
    const after = real[`${name}-after`]!
    expect(before.lastLearnedAt).toBeTruthy()
    expect(after.lastLearnedAt).toBe(before.lastLearnedAt)
    expect(real._meta[name]!.settingsLastLearnedAt).toBe(before.lastLearnedAt)
    expect(after.learning?.active).toBe(false)
    expect(after.learning?.errorCode).toBe(name.replace('-', '_'))
  })
}

for (const [name, sentence] of [
  ['key-missing', 'Add your AI key in Settings.'],
  ['secret-missing', 'Add your AI key again in Settings.'],
] as const) {
  test(`real ${name} Learn now: "${sentence}" with Open Settings, once, never Nothing new, header unchanged`, async ({ page }) => {
    await openApp(page, snap(`${name}-before`))
    const header = await status(page).getAttribute('aria-label')
    // With the provider turned off the real header reads "Not set up yet"; with only the secret gone it keeps last learned.
    if (name === 'key-missing') expect(header).toBe('Not set up yet')
    else expect(header).toMatch(/last learned/i)
    await learnNow(page)
    await reply(page, 'action', snap(`${name}-start`))
    await expect(page.getByText('Learning stopped')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: sentence })).toHaveCount(1)
    await expect(page.getByText(/No secret stored|Turn on a provider/)).toHaveCount(0)
    await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
    await expect(page.getByText(/^Done\./)).toHaveCount(0)
    await expect(status(page)).toHaveAttribute('aria-label', header!)
    // The state after the pass settles carries the same error: still one message.
    await emitLearning(page, snap(`${name}-after`))
    await expect(page.getByRole('alert').filter({ hasText: sentence })).toHaveCount(1)
    await page.getByRole('alert').getByRole('button', { name: 'Open Settings' }).click()
    await expect(page.getByRole('heading', { name: 'AI key' })).toBeFocused()
  })
}

test('real model-error Learn now: Learning stopped with the host text and Try again, no Settings link, never Nothing new or Done', async ({ page }) => {
  await openApp(page, snap('model-error-before'))
  const header = await status(page).getAttribute('aria-label')
  expect(header).toMatch(/last learned/i)
  await learnNow(page)
  await reply(page, 'action', snap('model-error-start'))
  await expect(page.getByText(/^Learning… 0 of 3 chats/)).toBeVisible()
  await emitLearning(page, snap('model-error-after'))
  await expect(page.getByText('Learning stopped')).toBeVisible()
  const alert = page.getByRole('alert').filter({ hasText: 'model timed out' })
  await expect(alert).toHaveCount(1)
  await expect(alert.getByRole('button', { name: 'Open Settings' })).toHaveCount(0)
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByText(/^Done\./)).toHaveCount(0)
  await expect(page.getByText('0 lessons learned')).toHaveCount(0)
  await expect(status(page)).toHaveAttribute('aria-label', header!)
  await alert.getByRole('button', { name: 'Try again' }).click()
  await page.waitForFunction(() => window.__sharlieCalls.filter((call) => call.cmd === 'action' && call.payload?.action === 'start-learning').length === 2)
})

test('a failed pass error can be dismissed, and a new pass clears it', async ({ page }) => {
  await openApp(page, snap('secret-missing-after'))
  await expect(page.getByText('Add your AI key again in Settings.')).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByText('Add your AI key again in Settings.')).toHaveCount(0)
  await expect(page.getByText('Learning stopped')).toHaveCount(0)
})
