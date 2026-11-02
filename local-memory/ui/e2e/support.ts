import { expect, type Page } from '@playwright/test'
import type { PageState } from '../src/types'

type Call = { id: number; cmd: string; payload: unknown; done: boolean }

declare global {
  interface Window {
    sharlie: {
      state: () => Promise<unknown>
      action: (body: Record<string, unknown>) => Promise<unknown>
      lookup: (query: string) => Promise<unknown>
      onLearning: (callback: (state: PageState) => void) => () => void
    }
    __sharlieCalls: Call[]
    __sharlieReply: (id: number, value: unknown) => void
    __sharlieFail: (id: number, message: string) => void
    __sharlieLearning?: Array<(state: PageState) => void>
    __sharlieCall: (cmd: string, payload?: unknown) => Promise<unknown>
    __sharlieGraph?: { screenCoords: (id: string) => { x: number; y: number } | null }
  }
}

export function pageState(overrides: Partial<PageState> = {}): PageState {
  return {
    title: 'Sharlie',
    paused: false,
    profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    provider: 'cursor',
    providers: ['cursor', 'copilot', 'anthropic', 'openai', 'custom'],
    savedProviders: ['cursor'],
    model: 'composer',
    modelParams: [],
    models: [{ id: 'composer', displayName: 'Composer' }],
    hasKey: true,
    keyExpiresAt: '',
    vaultPath: 'C:\\vault',
    drivePath: 'C:\\drive',
    autoDrop: false,
    cadence: '30m',
    customBaseUrl: '',
    sources: [{ tool: 'Cursor', path: 'C:\\Users\\ada\\.cursor' }],
    learning: null,
    learningTokens: 0,
    learningTokensUnreported: 0,
    ingest: null,
    graph: {
      canvas: '#1f1f1f',
      panel: '#252526',
      border: '#3c3c3c',
      text: '#cccccc',
      muted: '#9d9d9d',
      accent: '#5c5c5c',
      synced: '#6f8f78',
      pending: '#b89a6a',
      nodes: [],
      links: [],
    },
    ...overrides,
  }
}

export function graphWithNodes(): PageState['graph'] {
  return {
    ...pageState().graph,
    nodes: [
      {
        id: 'card:retry',
        kind: 'card',
        label: 'Retry',
        color: '#b89a6a',
        title: 'Retry the deploy',
        solution: 'Retry once',
        failure_modes: ['lock'],
        x: 80,
        y: 80,
        fx: 80,
        fy: 80,
        relations: [{ entity: 'card:retry', relation: 'APPLIES_TO', target_entity: 'vite' }],
      },
      {
        id: 'tool:vite',
        kind: 'tool',
        label: 'vite',
        color: '#9d9d9d',
        title: 'vite',
        x: 220,
        y: 140,
        fx: 220,
        fy: 140,
      },
    ],
    links: [{ source: 'card:retry', target: 'tool:vite' }],
  }
}

export async function installHost(page: Page) {
  // The app is dark-first; Chromium defaults to light, so pin dark unless a test opts into light.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    const calls: Call[] = []
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
    const learning: Array<(state: PageState) => void> = []
    let seq = 0
    const call = (cmd: string, payload?: unknown) => {
      const id = ++seq
      calls.push({ id, cmd, payload, done: false })
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
    }
    window.__sharlieCalls = calls
    window.__sharlieCall = call
    window.__sharlieLearning = learning
    window.__sharlieReply = (id, value) => {
      const entry = calls.find((item) => item.id === id)
      if (entry) entry.done = true
      const waiter = pending.get(id)
      pending.delete(id)
      waiter?.resolve(value)
    }
    window.__sharlieFail = (id, message) => {
      const entry = calls.find((item) => item.id === id)
      if (entry) entry.done = true
      const waiter = pending.get(id)
      pending.delete(id)
      waiter?.reject(new Error(message))
    }
    window.sharlie = {
      state: () => call('state'),
      action: (body) => call('action', body),
      lookup: (query) => call('lookup', query),
      onLearning: (callback) => {
        learning.push(callback)
        return () => {
          const index = learning.indexOf(callback)
          if (index >= 0) learning.splice(index, 1)
        }
      },
    }
  })
}

export async function reply(page: Page, cmd: string, value: unknown) {
  await page.waitForFunction((name) => window.__sharlieCalls?.some((call) => call.cmd === name && !call.done), cmd)
  await page.evaluate(
    ({ name, next }) => {
      for (const call of window.__sharlieCalls) {
        if (call.cmd === name && !call.done) window.__sharlieReply(call.id, next)
      }
    },
    { name: cmd, next: value },
  )
}

export async function emitLearning(page: Page, state: PageState) {
  await page.evaluate((next) => {
    for (const callback of window.__sharlieLearning ?? []) callback(next)
  }, state)
}

export async function fail(page: Page, cmd: string, message: string) {
  await page.waitForFunction((name) => window.__sharlieCalls?.some((call) => call.cmd === name && !call.done), cmd)
  await page.evaluate(
    ({ name, message: text }) => {
      for (const call of window.__sharlieCalls) {
        if (call.cmd === name && !call.done) window.__sharlieFail(call.id, text)
      }
    },
    { name: cmd, message },
  )
}

export async function lastCall(page: Page, cmd: string) {
  return page.evaluate((name) => {
    const calls = window.__sharlieCalls.filter((call) => call.cmd === name)
    const last = calls[calls.length - 1]
    if (!last) return null
    return { cmd: last.cmd, payload: last.payload }
  }, cmd)
}

export type HostExtras = { cancelLearning?: boolean }

/** Optional host methods (window.sharlie.cancelLearning) the UI checks for before use. */
export async function addHostExtras(page: Page, extras: HostExtras) {
  await page.addInitScript((flags: HostExtras) => {
    const sharlie = window.sharlie as Record<string, unknown>
    if (flags.cancelLearning) sharlie.cancelLearning = () => window.__sharlieCall('cancel')
  }, extras)
}

export async function openApp(page: Page, state: PageState, extras: HostExtras = {}) {
  await installHost(page)
  if (extras.cancelLearning) await addHostExtras(page, extras)
  await page.goto('/')
  await reply(page, 'state', state)
  await expect(page.getByRole('heading', { name: 'Sharlie', exact: true })).toBeVisible()
}

export async function clickNode(page: Page, id: string) {
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, id)
  await page.waitForTimeout(1000)
  const point = await page.evaluate((nodeId) => window.__sharlieGraph?.screenCoords(nodeId) ?? null, id)
  if (!point) throw new Error(`No screen point for ${id}`)
  const canvas = page.locator('[data-graph] canvas').last()
  await canvas.hover({ position: { x: point.x, y: point.y } })
  await page.waitForTimeout(200)
  await canvas.click({ position: { x: point.x, y: point.y }, force: true })
}
