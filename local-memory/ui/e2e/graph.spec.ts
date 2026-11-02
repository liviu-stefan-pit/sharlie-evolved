import { expect, test } from '@playwright/test'
import { clickNode, emitLearning, graphWithNodes, openApp, pageState } from './support'

test('a node opens one lesson panel, a chip replaces it, and Close removes it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.getByRole('button', { name: 'Start learning' })).toHaveCount(0)
  await clickNode(page, 'card:retry')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await expect(page.getByText('Retry once')).toBeVisible()
  await expect(page.getByText('lock')).toBeVisible()
  await expect(page.getByText('Only on this PC')).toBeVisible()

  await page.getByRole('dialog').getByRole('button', { name: 'vite' }).click()
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'vite' })).toBeVisible()

  await clickNode(page, 'card:retry')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('aside')).toHaveCount(0)
})

test('live card nodes keep their place and open a drawer', async ({ page }) => {
  await openApp(page, pageState())
  await expect(page.locator('[data-graph] canvas')).toHaveCount(0)

  const first = graphWithNodes()
  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 1, total: 2 },
      graph: first,
    }),
  )
  await expect(page.locator('[data-graph] canvas')).toBeVisible()
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:retry')

  const second = {
    ...first,
    nodes: [
      ...first.nodes,
      {
        id: 'card:lock',
        kind: 'card',
        label: 'Lock',
        color: '#b89a6a',
        title: 'Read the lock log',
        solution: 'Read the log',
        failure_modes: ['timeout'],
        x: 150,
        y: 110,
        fx: 150,
        fy: 110,
      },
    ],
  }
  await emitLearning(
    page,
    pageState({
      learning: { active: true, done: 2, total: 2 },
      graph: second,
    }),
  )
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:retry')
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:lock')

  await clickNode(page, 'card:lock')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Read the lock log' })).toBeVisible()
})

test('a lesson shows its From line and real card parts, and a work lesson has no local badge', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = graph.nodes.map((node) =>
    node.id === 'card:retry'
      ? { ...node, created_at: '2026-11-02T08:00:00.000Z', scope: 'work', summary: 'Deploys can hit a stale lock.', why: 'The lock clears in a minute.' }
      : node,
  )
  await openApp(page, pageState({ graph }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' }).click()
  const dialog = page.getByRole('dialog', { name: 'Retry the deploy' })
  await expect(dialog).toContainText('From: vite · 2 Nov')
  await expect(dialog).toContainText('Deploys can hit a stale lock.')
  await expect(dialog.getByRole('heading', { name: 'What to do' })).toBeVisible()
  await expect(dialog).toContainText('Retry once')
  await expect(dialog.getByRole('heading', { name: 'Why it works' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'What went wrong' })).toBeVisible()
  await expect(dialog.getByText('Only on this PC')).toHaveCount(0)
  await expect(dialog.getByText('On Drive')).toHaveCount(0)
})

test('Escape closes the lesson and returns focus to where it was opened', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('button', { name: 'List' }).click()
  const row = page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' })
  await row.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Retry the deploy' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Retry the deploy' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(row).toBeFocused()
})

test('a tool node drawer shows no sync line', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await clickNode(page, 'tool:vite')
  await expect(page.getByRole('heading', { name: 'vite' })).toBeVisible()
  await expect(page.getByText('On Drive')).toHaveCount(0)
  await expect(page.getByText('Only on this PC')).toHaveCount(0)
})

test('clicking empty canvas closes the drawer', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await clickNode(page, 'card:retry')
  await expect(page.locator('aside')).toHaveCount(1)
  const canvas = page.locator('[data-graph] canvas').last()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('No canvas')
  const points = await page.evaluate(() => [
    window.__sharlieGraph?.screenCoords('card:retry') ?? null,
    window.__sharlieGraph?.screenCoords('tool:vite') ?? null,
  ])
  const clear = (x: number, y: number) =>
    points.every((point) => !point || Math.hypot(point.x - x, point.y - y) > 48)
  const corners = [
    { x: 8, y: 8 },
    { x: 8, y: box.height - 8 },
    { x: Math.max(8, box.width - 300), y: 8 },
    { x: Math.max(8, box.width - 300), y: box.height - 8 },
  ]
  let spot = corners.find(
    (corner) => corner.x >= 6 && corner.y >= 6 && corner.x <= box.width - 6 && corner.y <= box.height - 6 && clear(corner.x, corner.y),
  )
  if (!spot) {
    spot = { x: 12, y: 12 }
    for (let y = 16; y < box.height - 16 && !clear(spot.x, spot.y); y += 20) {
      for (let x = 16; x < Math.min(box.width - 16, box.width - 290); x += 20) {
        if (clear(x, y)) {
          spot = { x, y }
          break
        }
      }
    }
  }
  await canvas.click({ position: spot, force: true })
  await expect(page.locator('aside')).toHaveCount(0)
})

test('hover fades the unlinked node', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = [
    {
      id: 'card:a',
      kind: 'card',
      label: 'A',
      color: '#b89a6a',
      title: 'Card A',
      solution: 'Do A',
      x: 80,
      y: 80,
      fx: 80,
      fy: 80,
    },
    {
      id: 'card:b',
      kind: 'card',
      label: 'B',
      color: '#b89a6a',
      title: 'Card B',
      solution: 'Do B',
      x: 220,
      y: 80,
      fx: 220,
      fy: 80,
    },
    {
      id: 'card:c',
      kind: 'card',
      label: 'C',
      color: '#b89a6a',
      title: 'Card C',
      solution: 'Do C',
      x: 480,
      y: 200,
      fx: 480,
      fy: 200,
    },
  ]
  graph.links = [{ source: 'card:a', target: 'card:b' }]
  await openApp(page, pageState({ graph }))
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:a')
  await page.waitForTimeout(1000)
  const point = await page.evaluate((nodeId) => window.__sharlieGraph?.screenCoords(nodeId) ?? null, 'card:a')
  if (!point) throw new Error('No screen point for card:a')
  await page.locator('[data-graph] canvas').last().hover({ position: { x: point.x, y: point.y } })
  await page.waitForTimeout(200)
  const colors = await page.evaluate(() => {
    const api = window.__sharlieGraph as { inspect?: () => { colors: number[] } } | undefined
    return api?.inspect?.().colors ?? []
  })
  const alpha = (index: number) => colors[index * 4 + 3] ?? Number.NaN
  expect(alpha(0)).toBeCloseTo(1, 2)
  expect(alpha(1)).toBeCloseTo(1, 2)
  expect(alpha(2)).toBeCloseTo(0.28, 1)
})

test('higher degree points are larger and redder', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = [
    {
      id: 'card:low',
      kind: 'card',
      label: 'Low',
      color: '#9d9d9d',
      title: 'Low degree',
      solution: 'None',
      degree: 0,
      x: 80,
      y: 80,
      fx: 80,
      fy: 80,
    },
    {
      id: 'card:high',
      kind: 'card',
      label: 'High',
      color: '#d4894a',
      title: 'High degree',
      solution: 'None',
      degree: 16,
      x: 240,
      y: 120,
      fx: 240,
      fy: 120,
    },
  ]
  graph.links = []
  await openApp(page, pageState({ graph }))
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:low')
  const read = await page.evaluate(() => {
    const api = window.__sharlieGraph as
      | { inspect?: () => { sizes: number[]; colors: number[] } }
      | undefined
    return api?.inspect?.() ?? { sizes: [], colors: [] }
  })
  expect(read.sizes[0]).toBeCloseTo(4, 0)
  expect(read.sizes[1]).toBeCloseTo(16, 0)
  expect(read.colors[4]).toBeGreaterThan(read.colors[0] ?? 0)
})

test('high degree nodes show labels', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = [
    {
      id: 'card:one',
      kind: 'card',
      label: 'One',
      color: '#d4894a',
      title: 'One',
      solution: 'One',
      degree: 16,
      x: 80,
      y: 80,
      fx: 80,
      fy: 80,
    },
    {
      id: 'card:two',
      kind: 'card',
      label: 'Two',
      color: '#d4894a',
      title: 'Two',
      solution: 'Two',
      degree: 16,
      x: 420,
      y: 260,
      fx: 420,
      fy: 260,
    },
  ]
  graph.links = []
  await openApp(page, pageState({ graph }))
  await expect(page.locator('[data-graph-label="card:one"]')).toHaveCount(1)
  await expect(page.locator('[data-graph-label="card:two"]')).toHaveCount(1)
})

test('without WebGL2 the map falls back to the lesson list', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype
    const original = proto.getContext as (this: HTMLCanvasElement, type: string, options?: unknown) => RenderingContext | null
    proto.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type === 'webgl2') return null
      return original.call(this, type, options)
    } as typeof proto.getContext
  })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.getByText("This PC can't draw the map, so here is the list.")).toBeVisible()
  const list = page.locator('[data-lesson-list]')
  await expect(list.getByRole('button', { name: 'Retry the deploy' })).toBeVisible()
  await list.getByRole('button', { name: 'Retry the deploy' }).click()
  await expect(page.locator('aside')).toBeVisible()
})

test('leaving a node restores the faded point', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = [
    {
      id: 'card:a',
      kind: 'card',
      label: 'A',
      color: '#b89a6a',
      title: 'Card A',
      solution: 'Do A',
      x: 80,
      y: 80,
      fx: 80,
      fy: 80,
    },
    {
      id: 'card:b',
      kind: 'card',
      label: 'B',
      color: '#b89a6a',
      title: 'Card B',
      solution: 'Do B',
      x: 220,
      y: 80,
      fx: 220,
      fy: 80,
    },
    {
      id: 'card:c',
      kind: 'card',
      label: 'C',
      color: '#b89a6a',
      title: 'Card C',
      solution: 'Do C',
      x: 480,
      y: 200,
      fx: 480,
      fy: 200,
    },
  ]
  graph.links = [{ source: 'card:a', target: 'card:b' }]
  await openApp(page, pageState({ graph }))
  await page.waitForFunction((nodeId) => {
    const point = window.__sharlieGraph?.screenCoords(nodeId)
    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
  }, 'card:a')
  const point = await page.evaluate((nodeId) => window.__sharlieGraph?.screenCoords(nodeId) ?? null, 'card:a')
  if (!point) throw new Error('No screen point for card:a')
  const canvas = page.locator('[data-graph] canvas').last()
  await canvas.hover({ position: { x: point.x, y: point.y } })
  const alphaAt = async (index: number) => {
    const colors = await page.evaluate(() => {
      const api = window.__sharlieGraph as { inspect?: () => { colors: number[] } } | undefined
      return api?.inspect?.().colors ?? []
    })
    return colors[index * 4 + 3] ?? Number.NaN
  }
  await expect.poll(() => alphaAt(2), { timeout: 5000 }).toBeCloseTo(0.28, 1)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('No canvas')
  const points = await page.evaluate(() => [
    window.__sharlieGraph?.screenCoords('card:a') ?? null,
    window.__sharlieGraph?.screenCoords('card:b') ?? null,
    window.__sharlieGraph?.screenCoords('card:c') ?? null,
  ])
  const clear = (x: number, y: number) =>
    points.every((spot) => !spot || Math.hypot(spot.x - x, spot.y - y) > 48)
  const corners = [
    { x: 8, y: 8 },
    { x: 8, y: box.height - 8 },
    { x: box.width - 8, y: 8 },
    { x: box.width - 8, y: box.height - 8 },
  ]
  const away = corners.find(
    (corner) =>
      corner.x >= 6 && corner.y >= 6 && corner.x <= box.width - 6 && corner.y <= box.height - 6 && clear(corner.x, corner.y),
  )
  if (!away) throw new Error('No clear corner')
  await canvas.hover({ position: away })
  await expect.poll(() => alphaAt(0), { timeout: 5000 }).toBeCloseTo(1, 2)
  await expect.poll(() => alphaAt(1), { timeout: 5000 }).toBeCloseTo(1, 2)
  await expect.poll(() => alphaAt(2), { timeout: 5000 }).toBeCloseTo(1, 2)
})

test('clicking another node replaces the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await clickNode(page, 'card:retry')
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await clickNode(page, 'tool:vite')
  await expect(page.locator('aside')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'vite' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toHaveCount(0)
})

test('zooming the map moves a label', async ({ page }) => {
  const graph = graphWithNodes()
  graph.nodes = [
    {
      id: 'card:one',
      kind: 'card',
      label: 'One',
      color: '#d4894a',
      title: 'One',
      solution: 'One',
      degree: 16,
      x: 80,
      y: 80,
      fx: 80,
      fy: 80,
    },
    {
      id: 'card:two',
      kind: 'card',
      label: 'Two',
      color: '#d4894a',
      title: 'Two',
      solution: 'Two',
      degree: 16,
      x: 420,
      y: 260,
      fx: 420,
      fy: 260,
    },
  ]
  graph.links = []
  await openApp(page, pageState({ graph }))
  const label = page.locator('[data-graph-label="card:one"]')
  await expect(label).toBeVisible()
  const first = await label.boundingBox()
  if (!first) throw new Error('No label box')
  const canvas = page.locator('[data-graph] canvas').last()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('No canvas')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -40)
  await expect
    .poll(async () => {
      const next = await label.boundingBox()
      if (!next) return 0
      return Math.max(Math.abs(next.x - first.x), Math.abs(next.y - first.y))
    }, { timeout: 5000 })
    .toBeGreaterThan(1)
})

test('the local badge is a neutral lock, never the amber dot, and Close is a 36px target', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.getByRole('button', { name: 'List' }).click()
  await page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' }).click()
  const badge = page.locator('[data-local-badge]')
  await expect(badge).toHaveText('Only on this PC')
  await expect(badge.locator('svg')).toHaveCount(1)
  await expect(badge).toHaveCSS('color', 'rgb(163, 169, 184)')
  const amber = await badge.evaluate((el) =>
    [...el.querySelectorAll('*')].some((child) => getComputedStyle(child).backgroundColor === 'rgb(184, 154, 106)'),
  )
  expect(amber).toBe(false)
  const close = await page.getByRole('dialog').getByRole('button', { name: 'Close' }).boundingBox()
  expect(close?.height).toBeGreaterThanOrEqual(36)
  expect(close?.width).toBeGreaterThanOrEqual(36)
})

test('long links fade with distance and follow the canvas size', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.waitForFunction(() => !!window.__sharlieGraph?.screenCoords('card:retry'))
  const read = () =>
    page.evaluate(() => (window.__sharlieGraph as { inspect?: () => { linkFade?: { range: number[]; min: number; opacity: number } } }).inspect?.().linkFade)
  const wide = await read()
  expect(wide?.min).toBeLessThanOrEqual(0.15)
  expect(wide?.opacity).toBeLessThan(1)
  expect(wide?.range[0]).toBeLessThan(wide?.range[1] ?? 0)
  await page.setViewportSize({ width: 600, height: 420 })
  await expect.poll(async () => (await read())?.range[1] ?? 0).toBeLessThan(wide?.range[1] ?? 0)
})
