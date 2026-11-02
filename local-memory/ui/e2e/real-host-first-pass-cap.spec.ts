import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { emitLearning, openApp, pageState, reply } from './support'
import type { PageState } from '../src/types'

// Real first pass on main (78a4650), /workspace/nova/sharlie-shots/realhost/drive5.mts: 60 chats, the newest one
// 100,000 characters. The host learns the newest 50 (deferredChats 10), cuts one (cappedChats 1), and keeps
// learning { active: false, notice } after the pass. Paths rewritten to Windows form.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-host-first-pass-cap.json', import.meta.url), 'utf8')) as Record<string, PageState>
const NOTICE = 'Learned the newest 50 chats. Older chats stay unread; later passes learn only new chats. 1 chat was cut to its newest 30,000 characters.'

test('real capped first pass: Done. 50 lessons learned, then the host sentence as sent', async ({ page }) => {
  expect(real.after!.learning?.notice).toBe(NOTICE)
  expect(real.after!.learning?.cappedChats).toBe(1)
  expect(real.after!.learning?.deferredChats).toBe(10)
  await openApp(page, structuredClone(real.before!))
  await page.getByRole('button', { name: 'Start learning' }).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && call.payload?.action === 'start-learning' && !call.done))
  await reply(page, 'action', structuredClone(real.start!))
  await expect(page.getByText(/^Learning… 0 of 50 chats/)).toBeVisible()
  await expect(page.getByText(NOTICE)).toHaveCount(0)
  await emitLearning(page, structuredClone(real.after!))
  await expect(page.getByText('Done. 50 lessons learned')).toBeVisible()
  await expect(page.getByText(NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('a finished pass without notice, cappedChats or deferredChats shows no extra line', async ({ page }) => {
  await openApp(page, pageState({ learning: { active: true, done: 0, total: 2 } }))
  await emitLearning(page, pageState({ learning: null, learningResult: { lessons: 2, chats: 2, text: '2 lessons learned' } }))
  await expect(page.getByText('Done. 2 lessons learned')).toBeVisible()
  await expect(page.getByText(/newest 50|30,000/)).toHaveCount(0)
})

test('a capped count without a host notice invents no sentence', async ({ page }) => {
  await openApp(page, pageState({ learning: { active: true, done: 0, total: 2 } }))
  await emitLearning(page, pageState({ learning: { active: false, done: 2, total: 2, cappedChats: 1 }, learningResult: { lessons: 2, chats: 2, text: '2 lessons learned' } }))
  await expect(page.getByText('Done. 2 lessons learned')).toBeVisible()
  await expect(page.getByText(/newest|30,000|cut/)).toHaveCount(0)
})
