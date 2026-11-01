import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..', '..')
const electronPath = require('electron') as string

const card = {
  id: 'card_20261101_000000',
  title: 'Retry the deploy',
  topics: ['deploy'],
  context: { os: 'windows', tool_version: '1', framework: 'vite' },
  solution: 'Retry once',
  failure_modes: ['lock'],
  relations: [],
  sources: ['cursor'],
  created_at: '2026-11-01T00:00:00.000Z',
  author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
}

async function viteUp() {
  try {
    const response = await fetch('http://127.0.0.1:1420')
    return response.status < 500
  } catch {
    return false
  }
}

async function startVite() {
  if (await viteUp()) return null
  const child = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'ui/vite.config.ts'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, VITE_E2E: '1' },
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await viteUp()) return child
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  child.kill()
  throw new Error('Vite did not start on port 1420')
}

async function clickNode(page: Page, id: string) {
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, id)
  const point = await page.evaluate((nodeId) => window.__sharlieGraph?.screenCoords(nodeId) ?? null, id)
  if (!point) throw new Error(`No screen point for ${id}`)
  const canvas = page.locator('[data-graph] canvas').last()
  await canvas.click({ position: point, force: true })
}

test('the Sharlie window opens a card and replaces it from the map', async () => {
  const home = await mkdtemp(join(tmpdir(), 'sharlie-window-'))
  const knowledge = join(home, '.sharlie', 'knowledge', 'cards')
  await mkdir(knowledge, { recursive: true })
  await mkdir(join(home, 'AppData', 'Roaming'), { recursive: true })
  await mkdir(join(home, 'AppData', 'Local'), { recursive: true })
  await writeFile(join(knowledge, `${card.id}.json`), JSON.stringify(card))
  let vite: ChildProcess | null = null
  let app: ElectronApplication | null = null
  try {
    vite = await startVite()
    app = await electron.launch({
      executablePath: electronPath,
      args: [root],
      cwd: root,
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        APPDATA: join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(home, 'AppData', 'Local'),
        SHARLIE_SKIP_LOGIN_ITEM: '1',
        SHARLIE_STRIP_TYPES: '1',
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { name: 'Sharlie' })).toBeVisible()
    await clickNode(page, 'topic:deploy')
    await expect(page.getByRole('heading', { name: 'deploy' })).toBeVisible()
    await page.getByRole('button', { name: 'Retry the deploy' }).click()
    await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
    await expect(page.getByText('Retry once')).toBeVisible()
    await expect(page.getByText('Only on this machine')).toBeVisible()
    await page.getByRole('button', { name: 'cursor', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'cursor' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toHaveCount(0)
    await page.waitForTimeout(2000)
  } finally {
    await app?.close()
    vite?.kill()
    await rm(home, { recursive: true, force: true })
  }
})
