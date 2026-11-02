import { expect, test, type Page } from '@playwright/test'
import { graphWithNodes, lastCall, openApp, pageState, reply } from './support'
import type { PageState } from '../src/types'

// Host 6220ee3: snapshot field shareAvailable. Only shareAvailable === true offers team sharing;
// false or missing (an older host) means unavailable.
const UNAVAILABLE = "Team sharing isn't available in this version. Your lessons stay on this PC."
const toggle = (page: Page) => page.getByRole('switch', { name: "Share work lessons with my team's Drive folder" })

async function settings(page: Page, state: PageState) {
  await openApp(page, state)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
}
function workGraph(): PageState['graph'] {
  const graph = graphWithNodes()
  return { ...graph, nodes: graph.nodes.map((node) => (node.kind === 'card' ? { ...node, scope: 'work', synced: false } : node)) }
}
function without(state: PageState, key: keyof PageState): PageState {
  const copy = { ...state }
  delete copy[key]
  return copy
}

const cases: [string, (state: PageState) => PageState][] = [
  ['false', (state) => ({ ...state, shareAvailable: false })],
  ['absent', (state) => without(state, 'shareAvailable')],
]

for (const [name, make] of cases) {
  test(`shareAvailable ${name}: switch off and disabled, unavailable sentence, no folder, Next to share or Sharing to`, async ({ page }) => {
    // share: true with a folder and a work queue: unavailable must still win.
    await settings(page, make(pageState({ share: true, drivePath: 'G:\\Team', graph: workGraph(), lastSharedAt: null })))
    await expect(toggle(page)).toBeDisabled()
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText(UNAVAILABLE)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change folder' })).toHaveCount(0)
    await expect(page.getByText(/Next to share/)).toHaveCount(0)
    await expect(page.getByText(/^Sharing to /)).toHaveCount(0)
    await expect(page.getByText('Not sharing. Everything stays on this PC.')).toHaveCount(0)
    await toggle(page).click({ force: true })
    await page.waitForTimeout(200)
    expect(await lastCall(page, 'action')).toBeNull()
    await expect(page.getByText('✓ Saved')).toHaveCount(0)
  })

  test(`shareAvailable ${name}: a work lesson says Only on this PC, never Waiting to share`, async ({ page }) => {
    await openApp(page, make(pageState({ share: true, drivePath: 'G:\\Team', graph: workGraph() })))
    await page.getByRole('button', { name: 'List' }).click()
    await page.getByRole('button', { name: 'Retry the deploy' }).first().click()
    await expect(page.getByText('Only on this PC', { exact: true })).toBeVisible()
    await expect(page.getByText('Waiting to share')).toHaveCount(0)
  })

  test(`shareAvailable ${name}: first run says sharing is unavailable and offers no Set up sharing`, async ({ page }) => {
    await openApp(page, make(pageState({ share: false, sources: [{ tool: 'Cursor', path: 'C:\\c', chats: 4 }], chatsFound: 4 })))
    await expect(page.getByText(UNAVAILABLE)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Set up sharing' })).toHaveCount(0)
  })
}

test('shareAvailable true keeps sharing: switch enabled, Waiting to share for an unsynced work lesson', async ({ page }) => {
  await openApp(page, pageState({ shareAvailable: true, share: true, drivePath: 'G:\\Team', graph: workGraph() }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByRole('button', { name: 'Retry the deploy' }).first().click()
  await expect(page.getByText('Waiting to share', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(toggle(page)).toBeEnabled()
  await expect(page.getByText(UNAVAILABLE)).toHaveCount(0)
})

test('a synced work lesson still says Shared when sharing is unavailable (it was copied before)', async ({ page }) => {
  const graph = workGraph()
  graph.nodes = graph.nodes.map((node) => (node.kind === 'card' ? { ...node, synced: true } : node))
  await openApp(page, pageState({ shareAvailable: false, share: false, graph }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.getByRole('button', { name: 'Retry the deploy' }).first().click()
  await expect(page.getByText('Shared', { exact: true })).toBeVisible()
})

test('a share_unavailable refusal from set-share shows the host sentence inline, no Saved, switch off', async ({ page }) => {
  await settings(page, pageState({ shareAvailable: true, share: false, drivePath: 'G:\\Team' }))
  await toggle(page).click()
  await page.waitForFunction(() => window.__sharlieCalls.some((call) => call.cmd === 'action' && !call.done))
  expect((await lastCall(page, 'action'))?.payload).toEqual({ action: 'set-share', enabled: 'true' })
  // Reply as src/window.ts applyShare on 6220ee3 sends it.
  await reply(page, 'action', pageState({ shareAvailable: false, share: false, drivePath: 'G:\\Team', errorCode: 'share_unavailable', notice: 'Team sharing is not available in this version.' }))
  await expect(page.getByText('Team sharing is not available in this version.')).toHaveCount(1)
  await expect(page.getByText(UNAVAILABLE)).toBeVisible()
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  await expect(toggle(page)).toBeDisabled()
  await page.waitForTimeout(200)
  await expect(page.getByText('✓ Saved')).toHaveCount(0)
})
