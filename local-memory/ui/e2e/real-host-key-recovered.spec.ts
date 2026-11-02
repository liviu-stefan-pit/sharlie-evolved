import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { emitLearning, lastCall, openApp, reply } from './support'
import type { PageState } from '../src/types'

// Real host on main (3b9d5db), /workspace/nova/sharlie-shots/realhost/drive4.mts SCENARIO=key-missing:
// a real pass (2 lessons), clear-provider, Learn now -> key_missing; then the Settings path that fixes it, captured with
// RECOVER=save (Replace key: save-key, then activate-provider because the reply's provider is '') and RECOVER=use
// (Use this key: activate-provider). save-key / activate-provider now clear learning.error: the replies carry
// { notice: '', learning: null, learningResult: null }. Paths rewritten to Windows form.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-host-key-recovered.json', import.meta.url), 'utf8')) as Record<string, PageState>
const snap = (key: string) => structuredClone(real[key]!)
const SENTENCE = 'Add your AI key in Settings.'

/** Waits for the n-th action call (still unanswered) and returns its payload. */
async function nextAction(page: Page, n: number) {
  await page.waitForFunction((count) => {
    const actions = window.__sharlieCalls.filter((call) => call.cmd === 'action')
    return actions.length >= count && !actions[count - 1]!.done
  }, n)
  return (await lastCall(page, 'action'))?.payload
}

async function failLearnNow(page: Page, run: 'save' | 'use') {
  await openApp(page, snap(`${run}:before`))
  await page.getByRole('button', { name: /^Learn now/ }).click()
  expect(await nextAction(page, 1)).toEqual({ action: 'start-learning' })
  await reply(page, 'action', snap(`${run}:start`))
  await emitLearning(page, snap(`${run}:after`))
  await expect(page.getByRole('alert').filter({ hasText: SENTENCE })).toHaveCount(1)
  await page.getByRole('alert').getByRole('button', { name: 'Open Settings' }).click()
}

async function backHomeIsClean(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Learn now/ })).toBeVisible()
  await expect(page.getByText(SENTENCE)).toHaveCount(0)
  await expect(page.getByText('Learning stopped')).toHaveCount(0)
  await expect(page.getByText(/Turn on a provider/)).toHaveCount(0)
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByText(/^Done\./)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // A later state poll with the same host snapshot keeps it clean.
  await emitLearning(page, snap('save:recover-state'))
  await expect(page.getByText(SENTENCE)).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
}

test('real host clears the key error: snapshots after save-key / activate-provider have learning null', () => {
  for (const key of ['save:recover-save-key', 'save:recover-activate', 'save:recover-state', 'use:recover-activate', 'use:recover-state']) {
    expect(real[key]!.learning, key).toBeNull()
    expect(real[key]!.learningResult, key).toBeNull()
  }
  expect(real['save:recover-save-key']!.notice).toBe('')
  expect(real['save:after']!.learning?.errorCode).toBe('key_missing')
})

test('Replace key after a key_missing Learn now: back on Home the "Add your AI key" strip is gone', async ({ page }) => {
  await failLearnNow(page, 'save')
  await page.getByRole('button', { name: 'Replace key' }).click()
  await page.getByLabel('Anthropic key').fill('sk-ant-api03-bbbb')
  await page.getByRole('button', { name: 'Save key' }).click()
  expect(await nextAction(page, 2)).toEqual({ action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-bbbb' })
  await reply(page, 'action', snap('save:recover-save-key'))
  expect(await nextAction(page, 3)).toEqual({ action: 'activate-provider', provider: 'anthropic' })
  await reply(page, 'action', snap('save:recover-activate'))
  await expect(page.getByText('Anthropic key saved · in use')).toBeVisible()
  await backHomeIsClean(page)
})

test('Use this key after a key_missing Learn now: back on Home the "Add your AI key" strip is gone', async ({ page }) => {
  await failLearnNow(page, 'use')
  await page.getByRole('button', { name: 'Use this key' }).click()
  expect(await nextAction(page, 2)).toEqual({ action: 'activate-provider', provider: 'anthropic' })
  await reply(page, 'action', snap('use:recover-activate'))
  await expect(page.getByText('Anthropic key saved · in use')).toBeVisible()
  await backHomeIsClean(page)
})
