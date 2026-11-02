import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { emitLearning, openApp, reply } from './support'
import type { PageState } from '../src/types'

// Real early Cancel on main (0f2ef27), /workspace/nova/sharlie-shots/realhost/drive6.mts: Start learning over 3 chats with
// a slow model, Cancel before any chat finished. The host answers learning null and
// learningResult { lessons: 0, chats: 0, text: 'Learning cancelled · 0 lessons learned' }. Paths rewritten to Windows form.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-host-early-cancel.json', import.meta.url), 'utf8')) as Record<string, PageState>
const snap = (key: string) => structuredClone(real[key]!)
const CANCELLED = 'Learning cancelled · 0 lessons learned'

test('real early Cancel (0 of 0) shows the host cancelled text, never Nothing new to learn', async ({ page }) => {
  expect(real.cancel!.learningResult).toEqual({ lessons: 0, chats: 0, text: CANCELLED })
  await openApp(page, snap('before'), { cancelLearning: true })
  await page.getByRole('button', { name: 'Start learning' }).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  await reply(page, 'action', snap('start'))
  await expect(page.getByText(/^Learning… 0 of 3 chats/)).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await reply(page, 'cancel', snap('cancel'))
  await expect(page.getByText(CANCELLED, { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByText(/^Done\./)).toHaveCount(0)
})

test('real early Cancel seen as a learning event (cancelled elsewhere) also shows the cancelled text', async ({ page }) => {
  await openApp(page, snap('before'))
  await page.getByRole('button', { name: 'Start learning' }).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  await reply(page, 'action', snap('mid'))
  await emitLearning(page, snap('after'))
  await expect(page.getByText(CANCELLED, { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
})
