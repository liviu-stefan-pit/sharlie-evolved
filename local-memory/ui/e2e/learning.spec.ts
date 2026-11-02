import { expect, test, type Page } from '@playwright/test'
import { emitLearning, fail, graphWithNodes, lastCall, openApp, pageState, reply } from './support'

const start = (page: Page) => page.getByRole('button', { name: 'Start learning' })

async function nextAction(page: Page) {
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  return (await lastCall(page, 'action'))?.payload
}

test('the first-run card explains what Sharlie does', async ({ page }) => {
  await openApp(page, pageState({ sources: [{ tool: 'Cursor', path: 'C:\\c', chats: 412 }], chatsFound: 412 }))
  await expect(page.getByRole('heading', { name: 'Sharlie learns from your work on this computer' })).toBeVisible()
  await expect(page.getByText('It reads the chats your coding tools already save, keeps short lessons on this PC, and removes names and secrets first.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Found: Cursor · 412 chats/ })).toBeVisible()
  await expect(page.getByText('Saved securely in Windows Credential Manager', { exact: false })).toBeVisible()
  await expect(page.getByText('Off. Everything stays on this PC.', { exact: false })).toBeVisible()
  await expect(start(page)).toBeEnabled()
  const box = await start(page).boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(44)
})

test('the provider list offers Anthropic, OpenAI, and Cursor only', async ({ page }) => {
  await openApp(page, pageState())
  const options = await page.getByLabel('Provider').locator('option').allTextContents()
  expect(options).toEqual(['Anthropic', 'OpenAI', 'Cursor'])
})

test('Start without a key says why and focuses the key field, never a dead button', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false, savedProviders: [], provider: '' }))
  await expect(start(page)).toBeEnabled()
  await start(page).click()
  await expect(page.getByText('Add an AI key so Sharlie can write lessons.')).toBeVisible()
  await expect(page.getByLabel('Anthropic key')).toBeFocused()
  expect(await lastCall(page, 'action')).toBeNull()
})

test('Start without a profile says why and focuses the name', async ({ page }) => {
  await openApp(page, pageState({ profile: { username: '', email: 'ada@example.com', team: 'platform' } }))
  await start(page).click()
  await expect(page.getByText('Add your name, email, and team so each lesson has an author.')).toBeVisible()
  await expect(page.getByLabel('Name')).toBeFocused()
})

test('About you saves on blur and shows Saved', async ({ page }) => {
  await openApp(page, pageState({ profile: { username: '', email: '', team: '' } }))
  await page.getByLabel('Name').fill('ada')
  await page.getByLabel('Email').click()
  expect(await nextAction(page)).toEqual({ action: 'save-profile', username: 'ada', email: '', team: '' })
  await reply(page, 'action', pageState({ profile: { username: 'ada', email: '', team: '' } }))
  await expect(page.getByText('✓ Saved')).toBeVisible()
})

test('saving a key switches the provider on and picks a model and its options', async ({ page }) => {
  const models = [
    {
      id: 'sonnet',
      displayName: 'Sonnet',
      parameters: [
        { id: 'effort', displayName: 'Effort', values: [{ value: 'low' }, { value: 'high' }] },
        { id: 'fast', displayName: 'Fast', values: [{ value: 'true' }, { value: 'false' }] },
      ],
    },
  ]
  const bare = { hasKey: false, savedProviders: [], provider: '', model: '', models: [] }
  await openApp(page, pageState(bare))
  await page.getByLabel('Provider').selectOption('anthropic')
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(page.getByText('Paste your Anthropic key first.')).toBeVisible()
  await page.getByLabel('Anthropic key').fill('sk-ant-1')
  await page.getByRole('button', { name: 'Save key' }).click()
  expect(await nextAction(page)).toEqual({ action: 'save-key', provider: 'anthropic', secret: 'sk-ant-1' })
  await reply(page, 'action', pageState({ ...bare, hasKey: true, savedProviders: ['anthropic'] }))
  expect(await nextAction(page)).toEqual({ action: 'activate-provider', provider: 'anthropic' })
  await reply(page, 'action', pageState({ ...bare, hasKey: true, savedProviders: ['anthropic'], provider: 'anthropic', models }))
  expect(await nextAction(page)).toEqual({ action: 'select-model', model: 'sonnet' })
  const chosen = { hasKey: true, savedProviders: ['anthropic'], provider: 'anthropic', models, model: 'sonnet' }
  await reply(page, 'action', pageState({ ...chosen, modelParams: [] }))
  expect(await nextAction(page)).toEqual({ action: 'set-model-param', id: 'effort', value: 'low' })
  await reply(page, 'action', pageState({ ...chosen, modelParams: [{ id: 'effort', value: 'low' }] }))
  expect(await nextAction(page)).toEqual({ action: 'set-model-param', id: 'fast', value: 'false' })
  await reply(page, 'action', pageState({ ...chosen, modelParams: [{ id: 'effort', value: 'low' }, { id: 'fast', value: 'false' }] }))
  await expect(page.getByText('Anthropic key saved.')).toBeVisible()
  await expect(page.getByLabel('Anthropic key')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'AI key (done)' })).toBeVisible()
})

const TROUBLE = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'

test('a rejected key shows once, inline in step 3, tied to the field', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false, savedProviders: [], provider: '' }))
  const key = page.getByLabel('Anthropic key')
  await key.fill('bad')
  await key.press('Enter')
  await reply(page, 'action', pageState({ hasKey: false, savedProviders: [], provider: '', notice: 'Anthropic said 401' }))
  const message = 'That key was rejected by Anthropic. Check it and try again'
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveText(message)
  const described = await key.getAttribute('aria-describedby')
  expect(described).toBeTruthy()
  await expect(page.locator(`[id="${described}"]`)).toHaveText(message)
  await expect(key).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Save key' })).toBeEnabled()
})

test('a thrown key error says something went wrong, raw text under Details', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false, savedProviders: [], provider: '' }))
  await page.getByLabel('Anthropic key').fill('bad')
  await page.getByLabel('Anthropic key').press('Enter')
  await fail(page, 'action', 'keyring: org.freedesktop.secrets was not provided')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByText(TROUBLE)).toBeVisible()
  await expect(page.getByText('keyring: org.freedesktop.secrets was not provided')).toBeHidden()
  await page.getByText('Details', { exact: true }).click()
  await expect(page.getByText('keyring: org.freedesktop.secrets was not provided')).toBeVisible()
})

test('a saved key that is off offers Use this key', async ({ page }) => {
  await openApp(page, pageState({ provider: '' }))
  await page.getByRole('button', { name: 'Use this key' }).click()
  expect(await nextAction(page)).toEqual({ action: 'activate-provider', provider: 'cursor' })
})

test('a provider with no model list says so on Start', async ({ page }) => {
  await openApp(page, pageState({ models: [], model: '' }))
  await start(page).click()
  await expect(page.getByText('This provider has no model list. Choose Anthropic or OpenAI.')).toBeVisible()
})

test('team sharing is optional and never blocks Start', async ({ page }) => {
  await openApp(page, pageState({ drivePath: '', autoDrop: false }))
  await expect(page.getByRole('heading', { name: /Team sharing.*\(optional\)/ })).toBeVisible()
  await start(page).click()
  expect(await nextAction(page)).toEqual({ action: 'start-learning' })
})

test('nothing found: neutral step, Check again, Start held with the reason', async ({ page }) => {
  await openApp(page, pageState({ sources: [] }))
  await expect(page.getByRole('heading', { name: /Found on this PC: nothing yet/ })).toBeVisible()
  const copy = page.getByText('Sharlie learns from chats saved by Cursor, Claude, or Copilot in VS Code. None were found on this PC. Use one of them for a while, then press Check again.')
  await expect(copy).toBeVisible()
  await expect(copy).not.toHaveCSS('color', 'rgb(240, 138, 126)')
  await expect(start(page)).toBeDisabled()
  await expect(page.getByText('Nothing to learn from yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show where I look' })).toHaveCount(0)

  // Check again is one explicit recheck-sources action; it never starts learning.
  await page.getByRole('button', { name: 'Check again' }).click()
  expect(await nextAction(page)).toEqual({ action: 'recheck-sources' })
  await reply(page, 'action', pageState({ sources: [] }))
  await expect(page.getByText('Still nothing found.')).toBeVisible()
  await page.getByRole('button', { name: 'Check again' }).click()
  await reply(page, 'action', pageState({ sources: [{ tool: 'Cursor', path: 'C:\\c', chats: 412 }], chatsFound: 412 }))
  await expect(page.getByRole('heading', { name: /Found: Cursor · 412 chats/ })).toBeVisible()
  await expect(start(page)).toBeEnabled()
  await page.waitForTimeout(300)
  const actions = await page.evaluate(() => window.__sharlieCalls.filter((call) => call.cmd === 'action').map((call) => call.payload))
  expect(actions).toEqual([{ action: 'recheck-sources' }, { action: 'recheck-sources' }])
})

test('chatsFound 0 holds Start even when a tool folder exists', async ({ page }) => {
  await openApp(page, pageState({ sources: [{ tool: 'Cursor', path: 'C:\\c', chats: 0 }], chatsFound: 0 }))
  await expect(page.getByRole('heading', { name: /Found on this PC: nothing yet/ })).toBeVisible()
  await expect(start(page)).toBeDisabled()
})

test('several sources join as one summary', async ({ page }) => {
  await openApp(page, pageState({ sources: [{ tool: 'Cursor', path: 'a', chats: 400 }, { tool: 'Claude CLI', path: 'b', chats: 12 }], chatsFound: 412 }))
  await expect(page.getByRole('heading', { name: /Found: Cursor, Claude CLI · 412 chats/ })).toBeVisible()
})

test('a no_chats refusal shows at step 1 and never a Done strip', async ({ page }) => {
  await openApp(page, pageState())
  await start(page).click()
  const notice = 'No AI coding chats were found. Sharlie looks in Cursor, Copilot, and Claude.'
  await reply(page, 'action', pageState({ errorCode: 'no_chats', notice, sources: [], chatsFound: 0 }))
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveText(notice)
  await expect(page.getByText(/^Done\./)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused()
})

test('a profile_incomplete refusal shows at About you and focuses Name', async ({ page }) => {
  await openApp(page, pageState())
  await start(page).click()
  const notice = 'Save your username, email, and team before learning can write cards.'
  await reply(page, 'action', pageState({ errorCode: 'profile_incomplete', notice }))
  await expect(page.getByRole('alert')).toHaveText(notice)
  await expect(page.getByText(/^Done\./)).toHaveCount(0)
  await expect(page.getByText('No lessons yet. Sharlie will learn as you work.')).toHaveCount(0)
  await expect(page.getByLabel('Name')).toBeFocused()
})

test('Show where I look lists every folder searched', async ({ page }) => {
  const searched = [
    { tool: 'Cursor', path: 'C:\\Users\\ada\\AppData\\Roaming\\Cursor\\User\\workspaceStorage' },
    { tool: 'Claude', path: 'C:\\Users\\ada\\.claude\\projects' },
  ]
  await openApp(page, pageState({ sources: [], searched }))
  await page.getByRole('button', { name: 'Show where I look' }).click()
  const list = page.getByRole('list', { name: 'Folders Sharlie looks in' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list).toContainText('.claude\\projects')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show where I look' })).toBeFocused()
})

test('Start collapses into the learning strip and counts chats', async ({ page }) => {
  await openApp(page, pageState())
  await start(page).click()
  await expect(start(page)).toHaveCount(0)
  await expect(page.getByRole('progressbar', { name: 'Starting to learn…' })).toBeVisible()

  await fail(page, 'action', 'Could not start learning')
  await expect(start(page)).toBeEnabled()
  await expect(page.getByText(TROUBLE)).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)

  await start(page).click()
  await reply(page, 'action', pageState({ learning: { active: true, done: 0, total: 412 } }))
  await expect(page.getByRole('progressbar', { name: 'Learning… 0 of 412 chats' })).toBeVisible()
  await emitLearning(page, pageState({ learning: { active: true, done: 37, total: 412 }, graph: graphWithNodes() }))
  const bar = page.getByRole('progressbar', { name: 'Learning… 37 of 412 chats' })
  await expect(bar).toHaveAttribute('aria-valuenow', '37')
  await expect(bar).toHaveAttribute('aria-valuemax', '412')
  await expect(page.getByText(/tokens/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  await emitLearning(page, pageState({ learning: { active: false, done: 412, total: 412 }, graph: graphWithNodes() }))
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByText('Done. 1 lesson learned')).toBeVisible()
  await page.getByRole('button', { name: 'See what I know' }).click()
  await expect(page.getByText('Done. 1 lesson learned')).toHaveCount(0)
  await expect(page.locator('[data-graph]')).toBeVisible()
})

test('Cancel shows only when the host can cancel, and calls it', async ({ page }) => {
  await openApp(page, pageState({ learning: { active: true, done: 3, total: 10 } }), { cancelLearning: true })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Cancelling' })).toBeDisabled()
  await reply(page, 'cancel', pageState({ learning: null, learningResult: { lessons: 2, chats: 3, text: 'Learning cancelled · 2 lessons learned' } }))
  await expect(page.getByRole('button', { name: /Cancel/ })).toHaveCount(0)
  await expect(page.getByText('Learning cancelled · 2 lessons learned')).toBeVisible()
})

test('the host learningResult text ends the pass', async ({ page }) => {
  await openApp(page, pageState({ learning: { active: true, done: 411, total: 412, lessons: 57 } }))
  await emitLearning(page, pageState({ learning: null, learningResult: { lessons: 58, chats: 412, text: '58 lessons learned' }, graph: graphWithNodes() }))
  await expect(page.getByText('Done. 58 lessons learned')).toBeVisible()
  await expect(page.getByRole('button', { name: 'See what I know' })).toBeVisible()
})

test('an error on the last event stays after learning clears', async ({ page }) => {
  await openApp(page, pageState({ learning: { active: true, done: 1, total: 2 } }))
  await emitLearning(page, pageState({ learning: { active: true, done: 1, total: 2, error: 'model timed out' } }))
  await emitLearning(page, pageState({ learning: null, learningResult: { lessons: 0, chats: 1, text: '0 lessons learned' } }))
  await expect(page.getByRole('alert').getByText('model timed out')).toBeVisible()
})

test('the learning log sits behind Details and sticks to the bottom', async ({ page }) => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
  const ingest = (more: string[]) => ({ visible: true, tokens: 0, unreported: 0, lines: [...lines, ...more] })
  await openApp(page, pageState({ learning: { active: true, done: 0, total: 20 }, ingest: ingest([]) }))
  await expect(page.getByRole('log', { name: 'Learning log' })).toHaveCount(0)
  await expect(page.getByText('line 20')).toBeVisible()
  await page.getByRole('button', { name: 'Details' }).click()
  const log = page.getByRole('log', { name: 'Learning log' })
  await expect(log.locator('p')).toHaveCount(20)
  await expect.poll(async () => log.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 24)).toBe(true)
  await log.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(async () => log.evaluate((el) => el.scrollTop)).toBe(0)
  await page.waitForTimeout(100)
  await emitLearning(page, pageState({ learning: { active: true, done: 1, total: 20 }, ingest: ingest(['line 21']) }))
  await expect(log.getByText('line 21')).toBeAttached()
  await expect.poll(async () => log.evaluate((el) => el.scrollTop)).toBe(0)
})

test('a failed first run keeps the card and shows the error once', async ({ page }) => {
  const failed = 'No secret stored for key key-1'
  await openApp(
    page,
    pageState({
      learning: { active: false, done: 0, total: 12, error: failed },
      ingest: { visible: true, tokens: 0, unreported: 0, lines: ['Found 12 transcripts', `failed · ${failed}`] },
    }),
  )
  await expect(page.getByRole('alert').getByText(failed, { exact: true })).toBeVisible()
  await expect(page.getByText('Learning stopped')).toBeVisible()
  await expect(start(page)).toBeEnabled()
})

test('a finished run with no lessons shows the Home empty state, never a blank graph', async ({ page }) => {
  await openApp(page, pageState({ learning: null, ingest: { visible: true, tokens: 0, unreported: 0, lines: ['cursor · a.json · skipped'] } }))
  await expect(page.getByText('No lessons yet. Sharlie will learn as you work.')).toBeVisible()
  await expect(start(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Check again' }).click()
  expect(await nextAction(page)).toEqual({ action: 'recheck-sources' })
})

test('a run that ends with zero lessons in this session lands on the Home empty state', async ({ page }) => {
  await openApp(page, pageState())
  await start(page).click()
  await reply(page, 'action', pageState({ learning: { active: true, done: 0, total: 2 } }))
  await emitLearning(page, pageState({ learning: { active: false, done: 2, total: 2 } }))
  await expect(page.getByText('Done. 0 lessons learned')).toBeVisible()
  await expect(page.getByText('No lessons yet. Sharlie will learn as you work.')).toBeVisible()
})

test('nothing learning-related shows once lessons exist', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes(), ingest: null }))
  await expect(start(page)).toHaveCount(0)
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('log', { name: 'Learning log' })).toHaveCount(0)
})
