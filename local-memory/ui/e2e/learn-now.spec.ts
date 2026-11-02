import { expect, test, type Page } from '@playwright/test'
import { emitLearning, graphWithNodes, openApp, pageState, reply } from './support'

const learnNow = (page: Page) => page.getByRole('button', { name: /^Learn now/ })
const home = (overrides = {}) => pageState({ graph: graphWithNodes(), sources: [{ tool: 'Cursor', path: 'C:\\c', chats: 12 }], chatsFound: 12, ...overrides })
const starts = (page: Page) =>
  page.evaluate(() => window.__sharlieCalls.filter((call) => call.cmd === 'action' && (call.payload as { action?: string })?.action === 'start-learning').length)

test('Learn now sits on Home after the first pass: 36px, secondary, beside the status', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openApp(page, home())
  await expect(learnNow(page)).toBeEnabled()
  const box = await learnNow(page).boundingBox()
  expect(box?.height).toBeGreaterThanOrEqual(36)
  // Secondary: not the blue-filled style (only Ask is filled).
  const bg = await learnNow(page).evaluate((el) => getComputedStyle(el).backgroundColor)
  const askBg = await page.getByRole('button', { name: 'Ask', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).not.toBe(askBg)
  await expect(page.getByRole('img', { name: 'Learns when you open Sharlie' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
})

test('Learn now fits at 360px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await openApp(page, home())
  await expect(learnNow(page)).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('five same-tick clicks send one start-learning with no profile resend', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).evaluate((el) => {
    for (let i = 0; i < 5; i++) (el as HTMLButtonElement).click()
  })
  await expect.poll(() => starts(page)).toBe(1)
  const payload = await page.evaluate(() => window.__sharlieCalls.filter((call) => call.cmd === 'action').map((call) => call.payload))
  expect(payload).toEqual([{ action: 'start-learning' }])
})

test('the learning strip shows progress, Learn now is disabled while active, then Last learned', async ({ page }) => {
  await openApp(page, home(), { cancelLearning: true })
  await learnNow(page).click()
  await expect(learnNow(page)).toBeDisabled()
  await reply(page, 'action', home({ learning: { active: true, done: 0, total: 3 } }))
  await emitLearning(page, home({ learning: { active: true, done: 1, total: 3 } }))
  await expect(page.getByText('Learning… 1 of 3 chats')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(learnNow(page)).toBeDisabled()
  await expect(learnNow(page)).toHaveAccessibleName(/learning is already running/)
  await emitLearning(page, home({ learning: null, learningResult: { lessons: 0, chats: 3, text: '0 lessons learned' }, lastLearnedAt: new Date().toISOString() }))
  await expect(page.getByText('Done. 0 lessons learned')).toBeVisible()
  await expect(learnNow(page)).toBeEnabled()
  await expect(page.getByRole('img', { name: 'Last learned just now' })).toBeVisible()
})

test('Cancel from a Learn now pass works as in first run', async ({ page }) => {
  await openApp(page, home(), { cancelLearning: true })
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: true, done: 1, total: 5 } }))
  await page.getByRole('button', { name: 'Cancel' }).click()
  await reply(page, 'cancel', home({ learning: null, learningResult: { lessons: 1, chats: 1, text: 'Learning cancelled · 1 lesson learned' } }))
  await expect(page.getByText('Learning cancelled · 1 lesson learned')).toBeVisible()
  await expect(learnNow(page)).toBeEnabled()
})

test('manual mode keeps "Learns when you ask" in front of the last-learned time', async ({ page }) => {
  await openApp(page, home({ cadence: 'manual' }))
  await expect(page.getByRole('img', { name: 'Learns when you ask' })).toBeVisible()
  await learnNow(page).click()
  await reply(page, 'action', home({ cadence: 'manual', learning: { active: true, done: 0, total: 1 } }))
  await emitLearning(page, home({ cadence: 'manual', learning: null, learningResult: { lessons: 1, chats: 1, text: '1 lesson learned' }, lastLearnedAt: new Date().toISOString() }))
  await expect(page.getByRole('img', { name: 'Learns when you ask · last learned just now' })).toBeVisible()
})

test('with no key saved, Learn now stays enabled and opens Settings at the AI key', async ({ page }) => {
  await openApp(page, home({ hasKey: false, savedProviders: [], provider: '' }))
  await expect(learnNow(page)).toBeEnabled()
  await learnNow(page).click()
  await expect(page.getByRole('heading', { name: 'AI key' })).toBeFocused()
  expect(await starts(page)).toBe(0)
})

test('a refused Learn now shows the sentence once, with a way to Settings', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ notice: 'Choose a model before learning can write cards.', errorCode: 'model_missing' }))
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a model before learning can write cards.' })).toHaveCount(1)
  await expect(page.getByText('Done.', { exact: false })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Settings' }).click()
  await expect(page.getByRole('heading', { name: 'AI key' })).toBeFocused()
})

test('a thrown Learn now error shows the plain sentence with Details', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  await page.evaluate(() => {
    for (const call of window.__sharlieCalls) if (call.cmd === 'action' && !call.done) window.__sharlieFail(call.id, 'ipc channel closed')
  })
  await expect(page.getByRole('button', { name: 'Details' })).toBeVisible()
  await expect(learnNow(page)).toBeEnabled()
})

test('a rerun with nothing new (reply already over) says Nothing new to learn and Last learned', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: false, done: 0, total: 0 }, lastLearnedAt: new Date().toISOString() }))
  await expect(page.getByText('Nothing new to learn')).toBeVisible()
  await expect(page.getByText('Starting to learn…')).toHaveCount(0)
  await expect(learnNow(page)).toBeEnabled()
  await expect(page.getByRole('img', { name: 'Last learned just now' })).toBeVisible()
})

test('a rerun with nothing new (event before the reply) ends once', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await emitLearning(page, home({ learning: { active: false, done: 0, total: 0 } }))
  await reply(page, 'action', home({ learning: { active: false, done: 0, total: 0 } }))
  await expect(page.getByText('Nothing new to learn')).toHaveCount(1)
  await expect(learnNow(page)).toBeEnabled()
})

/** First pass: 3 lessons, ended with the host's result. */
async function firstPassOfThree(page: Page) {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: true, done: 0, total: 3 } }))
  await emitLearning(page, home({ learning: null, learningResult: { lessons: 3, chats: 3, text: '3 lessons learned' } }))
  await expect(page.getByText('Done. 3 lessons learned')).toBeVisible()
}

for (const [name, after] of [
  ['finished 0 of 0, stale result', { learning: { active: false, done: 0, total: 0 }, learningResult: { lessons: 3, chats: 3, text: '3 lessons learned' } }],
  ['finished 0 of 0, result cleared', { learning: { active: false, done: 0, total: 0 }, learningResult: null }],
  ['learning null, new empty result', { learning: null, learningResult: { lessons: 0, chats: 0, text: '0 lessons learned' } }],
] as const) {
  test(`3 lessons, then a rerun with nothing new (${name}) says Nothing new to learn, never the old count`, async ({ page }) => {
    await firstPassOfThree(page)
    await learnNow(page).click()
    // The previous summary clears the moment a new pass starts.
    await expect(page.getByText('Done. 3 lessons learned')).toHaveCount(0)
    await reply(page, 'action', home(after))
    const strip = page.getByRole('status').filter({ hasText: 'Nothing new to learn' })
    await expect(strip).toBeVisible()
    await expect(page.getByText('3 lessons learned')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'See what I know' })).toHaveCount(0)
    // Calm, not amber or danger.
    expect(await strip.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 232, 238)')
  })
}

test('3 lessons, then the empty event arrives before the reply: Nothing new to learn once', async ({ page }) => {
  await firstPassOfThree(page)
  await learnNow(page).click()
  await emitLearning(page, home({ learning: { active: false, done: 0, total: 0 }, learningResult: { lessons: 3, chats: 3, text: '3 lessons learned' } }))
  await reply(page, 'action', home({ learning: { active: false, done: 0, total: 0 } }))
  await expect(page.getByText('Nothing new to learn')).toHaveCount(1)
  await expect(page.getByText('3 lessons learned')).toHaveCount(0)
})

test('3 lessons, then 2 new: Done. 2 lessons learned, not 5', async ({ page }) => {
  await firstPassOfThree(page)
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: true, done: 0, total: 2 } }))
  await emitLearning(page, home({ learning: { active: true, done: 1, total: 2 } }))
  await emitLearning(page, home({ learning: null, learningResult: { lessons: 2, chats: 2, text: '2 lessons learned' } }))
  await expect(page.getByText('Done. 2 lessons learned')).toBeVisible()
  await expect(page.getByText(/5 lessons|3 lessons learned/)).toHaveCount(0)
})

test('3 lessons, then 2 new without a host result: the count is this pass only', async ({ page }) => {
  const base = graphWithNodes()
  const withCards = (n: number) => ({
    ...base,
    nodes: [...base.nodes, ...Array.from({ length: n - 1 }, (_, i) => ({ ...base.nodes[0]!, id: `card:c${i}`, label: `c${i}`, title: `c${i}`, relations: [] }))],
  })
  await openApp(page, home({ graph: withCards(3) }))
  await learnNow(page).click()
  await reply(page, 'action', home({ graph: withCards(3), learning: { active: true, done: 0, total: 2 } }))
  await emitLearning(page, home({ graph: withCards(5), learning: null, learningResult: null }))
  await expect(page.getByText('Done. 2 lessons learned')).toBeVisible()
})

for (const width of [360, 768, 1280]) {
  test(`Home bar at ${width}px: Filter at least 120px, targets 36px, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 640 })
    await openApp(page, home())
    const filter = page.getByRole('searchbox', { name: 'Filter lessons' })
    const box = await filter.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(120)
    for (const target of [learnNow(page), page.getByRole('button', { name: 'Map' }), page.getByRole('button', { name: 'List' })]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const bar = await filter.evaluate((el) => {
      let node: HTMLElement | null = el
      while (node && !node.className.includes('border-b')) node = node.parentElement
      return node ? node.scrollWidth - node.clientWidth : 0
    })
    expect(bar).toBeLessThanOrEqual(0)
  })
}

// Sentinel MAJOR 2: key secret gone from Credential Manager, unread chats, the host returns ran:true.
const earlier = '2026-11-01T08:00:00.000Z'

test('real missing-secret reply (learning null, no result, no error) never says Nothing new or moves last learned', async ({ page }) => {
  // Captured from the real host on main: learning null, learningResult null, lastLearnedAt unchanged.
  await openApp(page, home({ lastLearnedAt: earlier, learningResult: { lessons: 2, chats: 2, text: '2 lessons learned' } }))
  const before = await page.locator('header [role="img"]').getAttribute('aria-label')
  await learnNow(page).click()
  await reply(page, 'action', home({ lastLearnedAt: earlier, learningResult: null, learning: null }))
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByRole('alert').getByText("Learning didn't run, and Sharlie gave no reason.", { exact: false })).toBeVisible()
  await expect(page.getByRole('alert').getByRole('button', { name: 'Open Settings' })).toBeVisible()
  await expect(page.locator('header [role="img"]')).toHaveAttribute('aria-label', before!)
  await expect(page.locator('header [role="img"]')).not.toHaveAttribute('aria-label', /just now/)
})

test('a finished snapshot carrying the missing-secret error shows "Add your AI key again in Settings" with a link', async ({ page }) => {
  await openApp(page, home({ lastLearnedAt: earlier }))
  await learnNow(page).click()
  await reply(page, 'action', home({ lastLearnedAt: earlier, learning: { active: false, done: 0, total: 4, error: 'No secret stored for key key-1' } }))
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByRole('alert').getByText('Add your AI key again in Settings.')).toHaveCount(1)
  await page.getByRole('alert').getByRole('button', { name: 'Open Settings' }).click()
  await expect(page.getByRole('heading', { name: 'AI key' })).toBeFocused()
})

test('the error event arriving before the reply also wins over Nothing new', async ({ page }) => {
  await openApp(page, home({ lastLearnedAt: earlier }))
  await learnNow(page).click()
  await emitLearning(page, home({ lastLearnedAt: earlier, learning: { active: false, done: 0, total: 0, error: 'No secret stored for key key-1' } }))
  await reply(page, 'action', home({ lastLearnedAt: earlier, learning: null, learningResult: { lessons: 0, chats: 0, text: '0 lessons learned' } }))
  await expect(page.getByText('Add your AI key again in Settings.')).toHaveCount(1)
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
})

test('a refused start with a missing-secret errorCode shows the same plain fix and Settings link', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ notice: 'No secret stored for key key-1', errorCode: 'key_secret_missing' }))
  await expect(page.getByRole('alert').filter({ hasText: 'Add your AI key again in Settings.' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible()
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
})

test('an unknown error on an empty finish shows the host text, not Nothing new', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: false, done: 0, total: 0, error: 'model timed out' } }))
  await expect(page.getByRole('alert').getByText('model timed out')).toBeVisible()
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
})

test('last learned comes only from the host: a pass that ends without lastLearnedAt leaves the status unchanged', async ({ page }) => {
  await openApp(page, home())
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: { active: true, done: 0, total: 1 } }))
  await emitLearning(page, home({ learning: null, learningResult: { lessons: 1, chats: 1, text: '1 lesson learned' } }))
  await expect(page.getByText('Done. 1 lesson learned')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Learns when you open Sharlie' })).toBeVisible()
})

test('learning null with the previous result (stale) is not a finished pass: says it did not run', async ({ page }) => {
  await openApp(page, home({ learningResult: { lessons: 3, chats: 3, text: '3 lessons learned' } }))
  await learnNow(page).click()
  await reply(page, 'action', home({ learning: null, learningResult: { lessons: 3, chats: 3, text: '3 lessons learned' } }))
  await expect(page.getByText('Nothing new to learn')).toHaveCount(0)
  await expect(page.getByText('3 lessons learned')).toHaveCount(0)
  await expect(page.getByText("Learning didn't run", { exact: false })).toBeVisible()
})
