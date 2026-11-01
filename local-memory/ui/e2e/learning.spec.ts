import { expect, test } from '@playwright/test'
import { emitLearning, fail, graphWithNodes, lastCall, openApp, pageState, reply } from './support'

test('start learning stays disabled without a key and recovers after a failure', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false }))
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Add a key in Settings.')).toBeVisible()
})

test('start learning shows live progress then the graph', async ({ page }) => {
  await openApp(page, pageState())
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeEnabled()
  await button.click()
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await expect(page.getByRole('progressbar', { name: 'Learning · 0 tokens', exact: true })).toBeVisible()

  await fail(page, 'action', 'Could not start learning')
  await expect(page.getByRole('button', { name: 'Start learning' })).toBeEnabled()
  await expect(page.getByText('Could not start learning')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)

  await page.getByRole('button', { name: 'Start learning' }).click()
  await reply(
    page,
    'action',
    pageState({
      learning: { active: true, done: 0, total: 2 },
    }),
  )
  await expect(page.getByRole('progressbar', { name: 'Learning 0 of 2 · 0 tokens' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)

  const live = pageState({
    learning: { active: true, done: 1, total: 2 },
    graph: graphWithNodes(),
  })
  await emitLearning(page, live)
  await expect(page.getByRole('progressbar', { name: 'Learning 1 of 2 · 0 tokens' })).toBeVisible()
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:retry')

  await emitLearning(
    page,
    pageState({
      learning: { active: false, done: 2, total: 2 },
      graph: graphWithNodes(),
    }),
  )
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await expect(page.locator('[data-graph]')).toBeVisible()
})

test('first ingest shows found, processed, and failed lines with the token total', async ({ page }) => {
  await openApp(page, pageState())
  const overlay = page.locator('.pointer-events-none.absolute.inset-0')
  await expect(overlay.getByRole('button', { name: 'Start learning' })).toBeEnabled()
  await expect(page.getByRole('log', { name: 'Learning log' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue learning' })).toHaveCount(0)

  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 0, total: 2 },
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines: ['Found 2 transcripts'],
      },
    }),
  )
  const log = page.getByRole('log', { name: 'Learning log' })
  await expect(page.getByText('Found 2 transcripts')).toBeVisible()
  await expect(page.locator('[data-graph]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await expect(page.getByText('queued')).toHaveCount(0)
  await expect(log.getByRole('button')).toHaveCount(0)

  const foundLine = 'Found 2 transcripts'
  const learningLine = 'cursor · deploy.json · learning'
  const cardLine = 'cursor · deploy.json · card "Retry the deploy"'
  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 1, total: 2 },
      learningTokens: 1500,
      ingest: {
        visible: true,
        tokens: 1500,
        unreported: 0,
        lines: [foundLine, learningLine, cardLine],
      },
    }),
  )
  await expect(page.getByRole('progressbar', { name: 'Learning 1 of 2 · 1,500 tokens' })).toBeVisible()
  await expect(page.locator('.border-t.border-line.bg-panel').getByText('Learning 1 of 2 · 1,500 tokens')).toHaveCount(2)
  await expect(page.getByText(cardLine)).toBeVisible()
  await expect
    .poll(async () => {
      const text = await log.innerText()
      const foundAt = text.indexOf(foundLine)
      const cardAt = text.indexOf(cardLine)
      return foundAt >= 0 && cardAt > foundAt
    })
    .toBe(true)
  await expect(log.getByRole('button')).toHaveCount(0)

  const failedLine = 'claude · lock.json · failed · model timed out'
  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 1, total: 2, error: 'model timed out' },
      learningTokens: 1500,
      ingest: {
        visible: true,
        tokens: 1500,
        unreported: 0,
        lines: [foundLine, learningLine, cardLine, failedLine],
      },
    }),
  )
  await expect(page.getByText(failedLine)).toBeVisible()
  await expect(page.getByText('model timed out').first()).toBeVisible()
  await expect
    .poll(async () => {
      const text = await log.innerText()
      const foundAt = text.indexOf(foundLine)
      const cardAt = text.indexOf(cardLine)
      const failedAt = text.indexOf(failedLine)
      return foundAt >= 0 && cardAt > foundAt && failedAt > cardAt
    })
    .toBe(true)
  await expect(log.getByRole('button')).toHaveCount(0)
})

test('a missing secret first ingest keeps the map, the pinned error, and Start learning', async ({ page }) => {
  const failed = 'No secret stored for key key-1'
  const failedLine = `failed · ${failed}`
  await openApp(
    page,
    pageState({
      learning: { active: false, done: 0, total: 12, error: failed },
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines: ['Found 12 transcripts', failedLine],
      },
    }),
  )
  const overlay = page.locator('.pointer-events-none.absolute.inset-0')
  const log = page.getByRole('log', { name: 'Learning log' })
  const panel = page.locator('.border-t.border-line.bg-panel')
  await expect(log.locator('p')).toHaveCount(2)
  await expect(log.getByText('Found 12 transcripts', { exact: true })).toBeVisible()
  await expect(log.getByText(failedLine, { exact: true })).toBeVisible()
  await expect(panel.getByText(failed, { exact: true })).toBeVisible()
  await expect(page.locator('[data-graph]')).toBeVisible()
  await expect(overlay.getByRole('button', { name: 'Start learning' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Continue learning' })).toHaveCount(0)
  await expect(log.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('queued')).toHaveCount(0)
})

test('a finished empty ingest keeps Start learning next to the log', async ({ page }) => {
  const skippedLine = 'cursor · deploy.json · skipped · lesson incomplete'
  const failedLine = 'cursor · deploy.json · failed · model timed out'
  await openApp(
    page,
    pageState({
      learning: null,
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines: [skippedLine, failedLine],
      },
    }),
  )
  const overlay = page.locator('.pointer-events-none.absolute.inset-0')
  await expect(overlay.getByRole('button', { name: 'Start learning' })).toBeEnabled()
  await expect(page.getByRole('log', { name: 'Learning log' }).getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue learning' })).toHaveCount(0)
  await expect(page.getByText(skippedLine)).toBeVisible()
  await expect(page.getByText(failedLine)).toBeVisible()
})

test('the ingest log is absent when the completed vault already has nodes', async ({ page }) => {
  await openApp(
    page,
    pageState({
      graph: graphWithNodes(),
      learningTokens: 1500,
      ingest: null,
    }),
  )
  await expect(page.getByText('queued')).toHaveCount(0)
  await expect(page.getByText('processed')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue learning' })).toHaveCount(0)
  await expect(page.getByRole('log', { name: 'Learning log' })).toHaveCount(0)
})

test('the ingest log sticks to the bottom unless the user scrolled up', async ({ page }) => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
  await openApp(
    page,
    pageState({
      learning: { active: true, done: 0, total: 20 },
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines,
      },
    }),
  )
  const log = page.getByRole('log', { name: 'Learning log' })
  await expect(log).toBeVisible()
  await expect
    .poll(async () => log.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true)

  await log.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(async () => log.evaluate((el) => el.scrollTop)).toBe(0)

  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 0, total: 20 },
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines: [...lines, 'line 21'],
      },
    }),
  )
  await expect(page.getByText('line 21')).toBeVisible()
  await expect.poll(async () => log.evaluate((el) => el.scrollTop)).toBe(0)

  await log.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 0, total: 20 },
      ingest: {
        visible: true,
        tokens: 0,
        unreported: 0,
        lines: [...lines, 'line 21', 'line 22'],
      },
    }),
  )
  await expect(page.getByText('line 22')).toBeVisible()
  await expect
    .poll(async () =>
      log.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 24),
    )
    .toBe(true)
})

test('start learning stays disabled until the profile is saved', async ({ page }) => {
  await openApp(
    page,
    pageState({ profile: { username: '', email: 'ada@example.com', team: 'platform' } }),
  )
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Save your username, email, and team before learning can write cards.')).toBeVisible()
})

test('start learning stays disabled until a provider is on', async ({ page }) => {
  await openApp(page, pageState({ provider: '' }))
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Turn on a provider before learning can write cards.')).toBeVisible()
})

test('start learning stays disabled when the SDK lists no models', async ({ page }) => {
  await openApp(page, pageState({ models: [], model: '' }))
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('This SDK has no model list. Switch to Anthropic or OpenAI to start learning.')).toBeVisible()
})

test('start learning stays disabled until a model is chosen', async ({ page }) => {
  await openApp(page, pageState({ model: '' }))
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Choose a model before learning can write cards.')).toBeVisible()
})

test('start learning stays disabled until effort is chosen', async ({ page }) => {
  await openApp(
    page,
    pageState({
      model: 'effort-model',
      modelParams: [],
      models: [
        {
          id: 'effort-model',
          displayName: 'Effort',
          parameters: [
            {
              id: 'effort',
              displayName: 'Effort',
              values: [{ value: 'low' }, { value: 'high' }],
            },
          ],
        },
      ],
    }),
  )
  const button = page.getByRole('button', { name: 'Start learning' })
  await expect(button).toBeDisabled()
  await expect(page.getByText('Choose effort and fast mode before learning can write cards.')).toBeVisible()
})

test('a successful start sends the payload and shows an unreported count', async ({ page }) => {
  await openApp(page, pageState())
  await page.getByRole('button', { name: 'Start learning' }).click()
  if ((await lastCall(page, 'action')) === null) {
    await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  }
  expect((await lastCall(page, 'action'))?.payload).toEqual({ action: 'start-learning' })
  await reply(
    page,
    'action',
    pageState({
      learning: { active: true, done: 0, total: 2 },
      learningTokensUnreported: 1,
    }),
  )
  await expect(
    page.getByRole('progressbar', {
      name: 'Learning 0 of 2 · 0 tokens · 1 call unreported',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByText('1 call unreported')).toBeVisible()
})
