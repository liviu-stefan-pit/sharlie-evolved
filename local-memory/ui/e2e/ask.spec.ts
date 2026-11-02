import { expect, test } from '@playwright/test'
import { fail, graphWithNodes, lastCall, openApp, pageState, reply } from './support'

const TROUBLE = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'
const retryRow = '[data-lesson-list] button:has-text("Retry the deploy")'
const viteRow = '[data-lesson-list] button:has-text("vite")'

test('Ask Sharlie is its own field: Enter asks and the answer is announced', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('how do I fix the deploy lock?')
  await ask.press('Enter')
  expect((await lastCall(page, 'lookup'))?.payload).toBe('how do I fix the deploy lock?')
  await expect(page.getByText('Looking through your lessons…')).toBeVisible()
  await reply(page, 'lookup', { answer: 'Retry the deploy once.' })
  const live = page.locator('[aria-live="polite"]').filter({ hasText: 'Retry the deploy once.' })
  await expect(live).toBeVisible()
  await expect(page.getByText('You asked:')).toContainText('how do I fix the deploy lock?')
  await expect(page.getByText('Looking through your lessons…')).toHaveCount(0)
  await expect(ask).toBeEnabled()
})

test('asking does not filter, and filtering does not ask', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByRole('textbox', { name: 'Ask Sharlie' }).fill('retry')
  await expect(page.locator(viteRow)).toBeVisible()
  const filter = page.getByRole('searchbox', { name: 'Filter lessons' })
  await filter.fill('RETRY')
  await expect(page.locator(retryRow)).toBeVisible()
  await expect(page.locator(viteRow)).toHaveCount(0)
  await filter.press('Enter')
  expect(await lastCall(page, 'lookup')).toBeNull()
  await filter.press('Escape')
  await expect(page.locator(viteRow)).toBeVisible()
})

test('a filter with no match says so and offers Clear filter', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('searchbox', { name: 'Filter lessons' }).fill('kubernetes')
  await expect(page.getByText('No lessons match “kubernetes”.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(page.getByRole('searchbox', { name: 'Filter lessons' })).toHaveValue('')
})

test('cited lessons are chips that open the lesson, even when filtered out', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('searchbox', { name: 'Filter lessons' }).fill('vite')
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('deploy?')
  await ask.press('Enter')
  await reply(page, 'lookup', { answer: 'Retry once.', cited: ['card:retry'] })
  await expect(page.getByRole('heading', { name: 'From these lessons' })).toBeVisible()
  await page.getByRole('button', { name: 'Retry the deploy' }).click()
  await expect(page.getByRole('searchbox', { name: 'Filter lessons' })).toHaveValue('')
  await expect(page.getByRole('dialog', { name: 'Retry the deploy' })).toBeVisible()
})

test('no citations from the host means no chips, never guessed ones', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('retry')
  await ask.press('Enter')
  await reply(page, 'lookup', { answer: 'Retry once.' })
  await expect(page.getByText('Retry once.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'From these lessons' })).toHaveCount(0)
})

test('an empty answer has a real empty state', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('what about kubernetes?')
  await ask.press('Enter')
  await reply(page, 'lookup', { answer: '' })
  await expect(page.getByText('Sharlie has no lesson about that yet. It will learn more as you work.')).toBeVisible()
})

test('asking with no lessons explains instead of calling the model', async ({ page }) => {
  await openApp(page, pageState())
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('anything')
  await ask.press('Enter')
  await expect(page.getByText('Sharlie has no lessons yet, so there is nothing to answer from.')).toBeVisible()
  expect(await lastCall(page, 'lookup')).toBeNull()
})

test('an empty question does not ask', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.press('Enter')
  expect(await lastCall(page, 'lookup')).toBeNull()
  await expect(ask).toBeFocused()
})

test('a failed ask shows the host-trouble line with Details, and can ask again', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const ask = page.getByRole('textbox', { name: 'Ask Sharlie' })
  await ask.fill('retry')
  await ask.press('Enter')
  await fail(page, 'lookup', 'No model')
  await expect(page.getByText(TROUBLE)).toBeVisible()
  await ask.press('Enter')
  await expect(page.getByText('Looking through your lessons…')).toBeVisible()
  await reply(page, 'lookup', { answer: 'Retry the deploy once.' })
  await expect(page.getByText('Retry the deploy once.')).toBeVisible()
  await page.getByRole('button', { name: 'Close answer' }).click()
  await expect(page.getByText('Retry the deploy once.')).toHaveCount(0)
})
