import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = 4174
const baseURL = `http://127.0.0.1:${port}`

function pageState(graph) {
  return {
    title: 'Sharlie',
    paused: false,
    profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    provider: 'cursor',
    providers: ['cursor'],
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
    sources: [],
    learning: null,
    graph,
  }
}

function benchGraph() {
  const hubs = 8
  const total = 5000
  const nodes = []
  const links = []
  for (let i = 0; i < hubs; i++) {
    nodes.push({
      id: `hub:${i}`,
      kind: 'developer',
      label: `hub ${i}`,
      color: '#9d9d9d',
      degree: 16,
      x: 80 + (i % 4) * 80,
      y: 80 + Math.floor(i / 4) * 80,
      fx: 80 + (i % 4) * 80,
      fy: 80 + Math.floor(i / 4) * 80,
    })
  }
  for (let i = hubs; i < total; i++) {
    const hub = i % hubs
    nodes.push({
      id: `leaf:${i}`,
      kind: 'card',
      label: `leaf ${i}`,
      color: '#b89a6a',
      degree: 1,
      x: 40 + ((i * 17) % 600),
      y: 40 + ((i * 13) % 440),
    })
    links.push({ source: `hub:${hub}`, target: `leaf:${i}` })
  }
  return {
    canvas: '#1f1f1f',
    panel: '#252526',
    border: '#3c3c3c',
    text: '#cccccc',
    muted: '#9d9d9d',
    accent: '#5c5c5c',
    synced: '#6f8f78',
    pending: '#b89a6a',
    nodes,
    links,
  }
}

function waitForOutput(child, match, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${match}`)), timeoutMs)
    const onData = (chunk) => {
      if (String(chunk).includes(match)) {
        clearTimeout(timer)
        child.stdout?.off('data', onData)
        child.stderr?.off('data', onData)
        resolve()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
  })
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'ui/vite.config.ts', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: root,
  env: { ...process.env, VITE_E2E: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

try {
  await waitForOutput(vite, String(port), 20000)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 680, height: 520 } })
  await page.addInitScript(() => {
    const calls = []
    const pending = new Map()
    let seq = 0
    const call = (cmd) => {
      const id = ++seq
      calls.push({ id, cmd, done: false })
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    }
    window.__sharlieCalls = calls
    window.__sharlieReply = (id, value) => {
      const entry = calls.find((item) => item.id === id)
      if (entry) entry.done = true
      pending.get(id)?.resolve(value)
      pending.delete(id)
    }
    window.sharlie = {
      state: () => call('state'),
      action: (body) => call('action', body),
      lookup: (query) => call('lookup', query),
      onLearning: () => () => {},
    }
  })
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__sharlieCalls?.some((call) => call.cmd === 'state' && !call.done))
  await page.evaluate((next) => {
    for (const call of window.__sharlieCalls) {
      if (call.cmd === 'state' && !call.done) window.__sharlieReply(call.id, next)
    }
  }, pageState(benchGraph()))
  await page.waitForFunction(() => window.__sharlieReady === true && window.__sharlieGraph?.inspect?.().sizes.length >= 5000, null, {
    timeout: 30000,
  })
  const before = await page.evaluate(() => window.__sharlieGraph.inspect())
  const canvas = page.locator('[data-graph] canvas').last()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Graph canvas is missing')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const after = await page.evaluate(() => window.__sharlieGraph.inspect())
  const leaves = []
  const hubs = []
  for (let i = 0; i < 8; i++) {
    hubs.push({
      size: before.sizes[i],
      r: before.colors[i * 4],
      g: before.colors[i * 4 + 1],
      b: before.colors[i * 4 + 2],
    })
  }
  for (let i = 8; i < 24; i++) {
    leaves.push({
      size: before.sizes[i],
      r: before.colors[i * 4],
      g: before.colors[i * 4 + 1],
      b: before.colors[i * 4 + 2],
    })
  }
  const leafGray = leaves.every((item) => item.size <= 5 && item.r > 0.55 && Math.abs(item.r - item.g) < 0.05)
  const hubOrange = hubs.every((item) => item.size >= 15 && item.r > item.b && item.g < item.r)
  const result = {
    nodes: before.sizes.length,
    labels: after.labels,
    leafGray,
    hubOrange,
    stillPaused: after.running === false,
    samePositions:
      before.positions.length === after.positions.length && before.positions.every((value, index) => value === after.positions[index]),
  }
  if (!result.leafGray || !result.hubOrange || result.labels > 48 || !result.stillPaused || !result.samePositions || result.nodes < 5000) {
    console.error('GRAPH_BENCH_FAIL', result)
    process.exitCode = 1
  } else {
    console.log('GRAPH_BENCH_OK', result)
  }
  await browser.close()
} catch (error) {
  console.error('GRAPH_BENCH_FAIL', error)
  process.exitCode = 1
} finally {
  vite.kill()
}
