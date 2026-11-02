import { expect, test, type Page } from '@playwright/test'
import { fail, graphWithNodes, lastCall, openApp, pageState, reply } from './support'
import type { PageState } from '../src/types'

const TROUBLE = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'

async function settings(page: Page, state: PageState = pageState()) {
  await openApp(page, state)
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
}

async function nextAction(page: Page) {
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  return (await lastCall(page, 'action'))?.payload
}

test('settings is one 640px column with About you, AI key, Team sharing, Advanced', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await settings(page)
  for (const name of ['About you', 'AI key', 'Team sharing']) {
    await expect(page.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false')
  const column = page.getByRole('heading', { name: 'Settings', level: 1 }).locator('..')
  const box = await column.boundingBox()
  expect(box?.width).toBeLessThanOrEqual(640)
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(0)
  const text = (await page.locator('body').innerText()).toLowerCase()
  for (const word of ['harvest', 'dropzone', 'auto-drop', 'vault', 'neo4j', 'copilot key', 'custom', 'tokens']) expect(text).not.toContain(word)
})

test('About you saves on blur with a Saved tick', async ({ page }) => {
  await settings(page)
  await page.getByLabel('Team', { exact: true }).fill('core')
  await page.getByLabel('Name', { exact: true }).click()
  expect(await nextAction(page)).toEqual({ action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'core' })
  await reply(page, 'action', pageState({ profile: { username: 'ada', email: 'ada@example.com', team: 'core' } }))
  await expect(page.getByRole('status').filter({ hasText: '✓ Saved' })).toHaveCount(1)
})

test('providers are Anthropic, OpenAI, and Cursor only', async ({ page }) => {
  await settings(page)
  expect(await page.getByLabel('Provider').locator('option').allTextContents()).toEqual(['Anthropic', 'OpenAI', 'Cursor'])
})

test('adding a key saves it, switches it on, and ticks Saved', async ({ page }) => {
  await settings(page)
  await page.getByLabel('Provider').selectOption('anthropic')
  await page.getByLabel('Anthropic key').fill('sk-ant')
  await page.getByRole('button', { name: 'Save key' }).click()
  expect(await nextAction(page)).toEqual({ action: 'save-key', provider: 'anthropic', secret: 'sk-ant' })
  await reply(page, 'action', pageState({ savedProviders: ['cursor', 'anthropic'] }))
  expect(await nextAction(page)).toEqual({ action: 'activate-provider', provider: 'anthropic' })
  await reply(page, 'action', pageState({ savedProviders: ['cursor', 'anthropic'], provider: 'anthropic' }))
  await expect(page.getByText('Anthropic key saved · in use')).toBeVisible()
  await expect(page.getByText('✓ Saved')).toBeVisible()
  await expect(page.getByLabel('Anthropic key')).toHaveCount(0)
})

test('a rejected key is shown once, inline, tied to the field', async ({ page }) => {
  await settings(page)
  await page.getByLabel('Provider').selectOption('openai')
  const key = page.getByLabel('OpenAI key')
  await key.fill('bad')
  await key.press('Enter')
  await reply(page, 'action', pageState({ notice: '401' }))
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveText('That key was rejected by OpenAI. Check it and try again')
  await expect(key).toHaveAttribute('aria-describedby', /.+/)
})

test('removing a key asks first; Keep key sends nothing', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Remove key…' }).click()
  await expect(page.getByText('Remove the Cursor key from this PC? Sharlie stops learning until you add a key again.')).toBeVisible()
  await page.getByRole('button', { name: 'Keep key' }).click()
  expect(await lastCall(page, 'action')).toBeNull()
  await expect(page.getByRole('button', { name: 'Remove key…' })).toBeFocused()
  await page.getByRole('button', { name: 'Remove key…' }).click()
  await page.getByRole('button', { name: 'Remove key', exact: true }).click()
  expect(await nextAction(page)).toEqual({ action: 'revoke-key', provider: 'cursor' })
})

test('replacing the Cursor key sends save-key', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Replace key' }).click()
  await page.getByLabel('Cursor key').fill('new')
  await page.getByRole('button', { name: 'Save key' }).click()
  expect(await nextAction(page)).toEqual({ action: 'save-key', provider: 'cursor', secret: 'new' })
})

test('a thrown host error goes to one pinned banner with one action and Details', async ({ page }) => {
  await settings(page)
  await page.getByRole('button', { name: 'Replace key' }).click()
  await page.getByLabel('Cursor key').fill('new')
  await page.getByRole('button', { name: 'Save key' }).click()
  await fail(page, 'action', 'keyring: no secret service')
  const banner = page.getByRole('alert')
  await expect(banner).toHaveCount(1)
  await expect(banner).toContainText(TROUBLE)
  await expect(banner.getByRole('button', { name: 'Try again' })).toBeVisible()
  await banner.getByText('Details', { exact: true }).click()
  await expect(banner).toContainText('keyring: no secret service')
  await banner.getByRole('button', { name: 'Try again' }).click()
  expect(await nextAction(page)).toEqual({ action: 'save-key', provider: 'cursor', secret: 'new' })
  await reply(page, 'action', pageState())
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('the banner stays pinned while the page scrolls and can be dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 })
  await settings(page)
  await page.getByLabel('Team', { exact: true }).fill('x')
  await page.getByLabel('Name', { exact: true }).click()
  await fail(page, 'action', 'boom')
  const banner = page.getByRole('alert')
  await page.getByRole('button', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: 'Advanced' }).scrollIntoViewIfNeeded()
  const box = await banner.boundingBox()
  expect(box?.y ?? 999).toBeLessThan(100)
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('sharing is off by default with Lyra copy', async ({ page }) => {
  await settings(page, pageState({ share: false }))
  const toggle = page.getByRole('switch', { name: "Share work lessons with my team's Drive folder" })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText("Only lessons from work projects are copied. Sharlie removes secrets such as keys and passwords, and other people's email addresses, before anything is sent to the AI. Personal lessons never leave this PC.")).toBeVisible()
  await expect(page.getByText('Not sharing. Everything stays on this PC.')).toBeVisible()
})

test('turning sharing on with no folder opens the picker, then set-share', async ({ page }) => {
  await settings(page, pageState({ share: false, drivePath: '' }))
  await page.getByRole('switch').click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'share' })
  await reply(page, 'action', pageState({ share: false, drivePath: 'G:\\My Drive\\Sharlie' }))
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'true' })
  const graph = graphWithNodes()
  graph.nodes = graph.nodes.map((node) => (node.kind === 'card' ? { ...node, scope: 'work' } : node))
  await reply(page, 'action', pageState({ share: true, drivePath: 'G:\\My Drive\\Sharlie', graph }))
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Sharing to G:\\My Drive\\Sharlie')).toBeVisible()
  await expect(page.getByText('Next to share: 1 lesson')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Next to share' })).toContainText('Retry the deploy')
})

test('a cancelled picker leaves sharing off and sends nothing else', async ({ page }) => {
  await settings(page, pageState({ share: false, drivePath: '' }))
  await page.getByRole('switch').click()
  await reply(page, 'action', pageState({ share: false, drivePath: '' }))
  await page.waitForTimeout(200)
  const actions = await page.evaluate(() => window.__sharlieCalls.filter((c) => c.cmd === 'action').length)
  expect(actions).toBe(1)
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

test('an unreachable team folder shows the one banner with Choose folder again', async ({ page }) => {
  await settings(page, pageState({ share: false, drivePath: 'G:\\gone' }))
  await page.getByRole('switch').click()
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'true' })
  await reply(page, 'action', pageState({ share: false, drivePath: 'G:\\gone', errorCode: 'path_not_found', notice: 'That folder does not exist.' }))
  const banner = page.getByRole('alert')
  await expect(banner).toContainText("Your team folder isn't reachable.")
  await banner.getByRole('button', { name: 'Choose folder again' }).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'share' })
})

test('turning sharing off sends set-share false', async ({ page }) => {
  await settings(page, pageState({ share: true, drivePath: 'G:\\My Drive\\Sharlie' }))
  await page.getByRole('switch').click()
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'false' })
})

test('When to learn names the real cadence once the host reports it scheduled', async ({ page }) => {
  await settings(page, pageState({ cadence: '1h', scheduled: true }))
  await page.getByRole('button', { name: 'Advanced' }).click()
  const learn = page.getByLabel('When to learn')
  expect(await learn.locator('option').allTextContents()).toEqual(['Every hour', 'Only when I start it'])
  await expect(learn).toHaveValue('1h')
})

for (const old of ['15m', '30m'] as const) {
  test(`an older host sending ${old} shows Every hour and offers only 1h or manual`, async ({ page }) => {
    await settings(page, pageState({ cadence: old, scheduled: true }))
    await page.getByRole('button', { name: 'Advanced' }).click()
    const learn = page.getByLabel('When to learn')
    expect(await learn.locator('option').allTextContents()).toEqual(['Every hour', 'Only when I start it'])
    expect(await learn.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))).toEqual(['1h', 'manual'])
    await expect(learn).toHaveValue('1h')
  })
}

test('a cadence_too_short refusal shows the host sentence under When to learn, with no Saved', async ({ page }) => {
  await settings(page, pageState({ cadence: 'manual', scheduled: true }))
  await page.getByRole('button', { name: 'Advanced' }).click()
  const learn = page.getByLabel('When to learn')
  await learn.selectOption('1h')
  expect(await nextAction(page)).toEqual({ action: 'set-cadence', cadence: '1h' })
  // Sentence and code as sent by src/window.ts set-cadence on main (7d3ad3a).
  await reply(page, 'action', pageState({ cadence: 'manual', scheduled: true, errorCode: 'cadence_too_short', notice: 'The schedule cannot be shorter than 1 hour.' }))
  const inline = page.getByText('The schedule cannot be shorter than 1 hour.')
  await expect(inline).toHaveCount(1)
  await expect(learn).toHaveAttribute('aria-describedby', await inline.getAttribute('id') ?? 'missing')
  await expect(learn).toHaveValue('manual')
  await page.waitForTimeout(200)
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
})

test('without host sharing support the switch is disabled, says so, and never shows Saved', async ({ page }) => {
  await settings(page, pageState({ share: undefined }))
  const toggle = page.getByRole('switch')
  await expect(toggle).toBeDisabled()
  await expect(page.getByText("Team sharing isn't available in this version yet")).toBeVisible()
  await expect(page.getByText('Not sharing. Everything stays on this PC.')).toHaveCount(0)
  await toggle.click({ force: true })
  await page.waitForTimeout(200)
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
  expect(await lastCall(page, 'action')).toBeNull()
})

test('a host reply without the share field turns sharing off as unsupported, without Saved', async ({ page }) => {
  await settings(page, pageState({ share: false, drivePath: 'G:\\Team' }))
  await page.getByRole('switch').click()
  expect(await nextAction(page)).toEqual({ action: 'set-share', enabled: 'true' })
  await reply(page, 'action', pageState({ share: undefined }))
  await expect(page.getByText("Team sharing isn't available in this version yet")).toBeVisible()
  await expect(page.getByRole('switch')).toBeDisabled()
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
})

test('Advanced holds model, options, cadence, folder, and theme', async ({ page }) => {
  const models = [{ id: 'sonnet', displayName: 'Sonnet', parameters: [{ id: 'effort', displayName: 'Effort', values: [{ value: 'low' }, { value: 'high' }] }, { id: 'fast', displayName: 'Fast', values: [{ value: 'true' }, { value: 'false' }] }] }]
  await settings(page, pageState({ models, model: 'sonnet', modelParams: [{ id: 'effort', value: 'low' }], cadence: '1h', chatsFound: 412 }))
  await page.getByRole('button', { name: 'Advanced' }).click()
  await expect(page.getByLabel('Model')).toHaveValue('sonnet')
  await page.getByLabel('Effort').selectOption('high')
  expect(await nextAction(page)).toEqual({ action: 'set-model-param', id: 'effort', value: 'high' })
  await reply(page, 'action', pageState({ models, model: 'sonnet', modelParams: [{ id: 'effort', value: 'high' }] }))
  await expect(page.getByText('✓ Saved')).toBeVisible()
  await page.getByLabel('Fast').click()
  expect(await nextAction(page)).toEqual({ action: 'set-model-param', id: 'fast', value: 'true' })
  await reply(page, 'action', pageState({ models, model: 'sonnet' }))

  const learn = page.getByLabel('When to learn')
  // No registered schedule reported: the timed option promises only what runs.
  expect(await learn.locator('option').allTextContents()).toEqual(['When I open Sharlie', 'Only when I start it'])
  await expect(learn).toHaveValue('1h')
  await learn.selectOption('manual')
  expect(await nextAction(page)).toEqual({ action: 'set-cadence', cadence: 'manual' })
  await reply(page, 'action', pageState({ cadence: 'manual' }))

  await page.getByRole('button', { name: 'Choose folder' }).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'knowledge' })
  await reply(page, 'action', pageState({ errorCode: 'path_not_writable', notice: 'Sharlie cannot write to that folder.' }))
  await expect(page.getByRole('alert')).toHaveText('Sharlie cannot write to that folder.')
  await expect(page.getByRole('radio', { name: 'Match Windows' })).toBeChecked()
})

test('a model refusal shows inline next to the model', async ({ page }) => {
  await settings(page, pageState({ models: [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }], model: 'a' }))
  await page.getByRole('button', { name: 'Advanced' }).click()
  await page.getByLabel('Model').selectOption('b')
  expect(await nextAction(page)).toEqual({ action: 'select-model', model: 'b' })
  await reply(page, 'action', pageState({ models: [{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }], model: 'a', notice: 'That model is not available.' }))
  await expect(page.getByRole('alert')).toHaveText('That model is not available.')
})

test('every settings control is at least 36px tall at 360', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await settings(page)
  await page.getByRole('button', { name: 'Advanced' }).click()
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main, body')[0]!.querySelectorAll('button, select, input:not([type=checkbox]):not([type=radio])')]
      .filter((el) => (el as HTMLElement).offsetParent !== null && el.closest('header') === null)
      .map((el) => ({ text: (el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName, h: el.getBoundingClientRect().height }))
      .filter((item) => item.h < 35.5),
  )
  expect(small).toEqual([])
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('Choose folder that leaves the Lessons folder unchanged never shows Saved', async ({ page }) => {
  await settings(page, pageState({ vaultPath: 'C:\\vault' }))
  await page.getByRole('button', { name: 'Advanced' }).click()
  await page.getByRole('button', { name: 'Choose folder' }).click()
  expect(await nextAction(page)).toEqual({ action: 'pick-folder', purpose: 'knowledge' })
  // The real host has no pick-folder yet: it answers with the same snapshot and an empty notice.
  await reply(page, 'action', pageState({ vaultPath: 'C:\\vault', notice: '' }))
  await page.waitForTimeout(200)
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose folder' }).click()
  await page.waitForFunction(() => window.__sharlieCalls.filter((call) => call.cmd === 'action' && !call.done).length === 1)
  await reply(page, 'action', pageState({ vaultPath: 'D:\\lessons', notice: '' }))
  await expect(page.getByText('✓ Saved')).toBeVisible()
})
