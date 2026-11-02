import { expect, test } from '@playwright/test'
import { clickNode, emitLearning, fail, graphWithNodes, installHost, openApp, pageState, reply } from './support'

test('the header stays up while the page loads, errors, and switches views', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sharlie', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Ask Sharlie' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sources' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Loading the graph')).toBeVisible()

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Loading the graph')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toHaveCount(0)

  await reply(page, 'state', pageState())
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toBeVisible()
  await expect(page.getByText('Loading the graph')).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start learning' })).toBeVisible()
})

test('a host error stays on screen when Settings is pressed', async ({ page }) => {
  await installHost(page)
  await page.goto('/')
  await fail(page, 'state', 'Sharlie host is not available')
  await expect(page.getByText('Sharlie host is not available')).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByText('Sharlie host is not available')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sources' })).toBeVisible()
})

test('settings opens over a loaded graph without a blank frame', async ({ page }) => {
  await openApp(page, pageState())
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'About you', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-graph]')).toBeVisible()
})

test('a set-up app says it learns every hour, in the success colour, only when the host runs that schedule', async ({ page }) => {
  await openApp(page, pageState({ paused: false, cadence: '1h', scheduled: true }))
  const mark = page.getByRole('img', { name: 'Learns every hour' })
  await expect(mark).toBeVisible()
  await expect(mark).toHaveCSS('background-color', 'rgb(127, 176, 141)')
})

for (const [cadence, scheduled, label] of [
  // An older host may still send 15m or 30m; one hour is now the shortest schedule, so both read every hour.
  ['30m', true, 'Learns every hour'],
  ['15m', true, 'Learns every hour'],
  ['1h', undefined, 'Learns when you open Sharlie'],
  ['30m', false, 'Learns when you open Sharlie'],
  ['manual', true, 'Learns when you ask'],
] as const) {
  test(`status line for cadence ${cadence}, scheduled ${String(scheduled)}: ${label}`, async ({ page }) => {
    await openApp(page, pageState({ cadence, scheduled }))
    await expect(page.getByRole('img', { name: label, exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: /every/ })).toHaveCount(label.includes('every') ? 1 : 0)
  })
}

test('a paused app says Learning paused in the muted colour', async ({ page }) => {
  await openApp(page, pageState({ paused: true }))
  const mark = page.getByRole('img', { name: 'Learning paused' })
  await expect(mark).toBeVisible()
  await expect(mark).toHaveCSS('background-color', 'rgb(163, 169, 184)')
})

test('the status never claims learning when nothing is set up', async ({ page }) => {
  await openApp(page, pageState({ hasKey: false, savedProviders: [], provider: '', paused: false }))
  await expect(page.getByRole('img', { name: 'Not set up yet' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Learns|Learning now/ })).toHaveCount(0)
  expect((await page.content()).toLowerCase()).not.toContain('harvest')
})

test('a running pass shows Learning now in amber', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes(), learning: { active: true, done: 1, total: 4 } }))
  await expect(page.getByRole('img', { name: 'Learning now' })).toHaveCSS('background-color', 'rgb(184, 154, 106)')
})

test('Home toggles between the map and the list', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.getByText('1 lesson', { exact: true })).toBeVisible()
  const map = page.getByRole('button', { name: 'Map' })
  const list = page.getByRole('button', { name: 'List' })
  await expect(map).toHaveAttribute('aria-pressed', 'true')
  await list.click()
  await expect(list).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-graph]')).toHaveCount(0)
  await page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' }).click()
  await expect(page.getByRole('heading', { name: 'Retry the deploy' })).toBeVisible()
  await map.click()
  await expect(page.locator('[data-graph]')).toBeVisible()
})

test('the map paints with the UI tokens, not the host palette', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await expect(page.locator('[data-graph]')).toHaveCSS('background-color', 'rgb(20, 22, 28)')
})

test('a newly learned lesson glows once', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  await page.waitForFunction(() => !!window.__sharlieGraph?.screenCoords('card:retry'))
  const graph = graphWithNodes()
  graph.nodes.push({ id: 'card:new', kind: 'card', label: 'New', color: '#b89a6a', title: 'New lesson', x: 150, y: 110, fx: 150, fy: 110 })
  await emitLearning(page, pageState({ graph }))
  await expect(page.locator('[data-graph-glow="card:new"]')).toHaveCount(1)
  await expect(page.locator('[data-graph-glow]')).toHaveCount(0, { timeout: 3000 })
  await expect(page.locator('[data-graph-glow="card:retry"]')).toHaveCount(0)
})

function busyGraph() {
  const graph = graphWithNodes()
  graph.nodes = []
  graph.links = []
  for (let i = 0; i < 60; i++) {
    graph.nodes.push({ id: `tool:t${i}`, kind: 'tool', label: `topic${i}`, color: '#9d9d9d', title: `topic${i}`, degree: 60 - i, x: 20 + (i % 10) * 30, y: 20 + Math.floor(i / 10) * 30, fx: 20 + (i % 10) * 30, fy: 20 + Math.floor(i / 10) * 30 })
  }
  return graph
}

for (const [width, cap] of [[1280, 12], [768, 12], [360, 6]] as const) {
  test(`the top ${cap} nodes by degree are labelled at ${width}px, plus the selected one`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await openApp(page, pageState({ graph: busyGraph() }))
    await page.waitForFunction(() => !!window.__sharlieGraph?.screenCoords('tool:t0'))
    const labels = page.locator('[data-graph-label]')
    await expect(labels).toHaveCount(cap)
    const ids = await labels.evaluateAll((items) => items.map((item) => item.getAttribute('data-graph-label')).sort())
    expect(ids).toEqual(Array.from({ length: cap }, (_, i) => `tool:t${i}`).sort())
    await clickNode(page, 'tool:t59')
    await expect(page.locator('[data-graph-label="tool:t59"]')).toHaveCount(1)
    await expect(labels).toHaveCount(cap + 1)
  })
}

for (const [width, expected] of [[1280, 400], [900, 306]] as const) {
  test(`the lesson side panel is clamp(280px,34vw,400px) at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await openApp(page, pageState({ graph: graphWithNodes() }))
    await page.getByRole('button', { name: 'List' }).click()
    await page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' }).click()
    const panel = page.locator('[data-lesson-detail="panel"]')
    const box = await panel.boundingBox()
    if (!box) throw new Error('panel is missing')
    expect(Math.abs(box.width - expected)).toBeLessThanOrEqual(1)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  })
}

for (const width of [360, 680]) {
  test(`under 760px the lesson opens as a bottom sheet at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 })
    await openApp(page, pageState({ graph: graphWithNodes() }))
    await page.getByRole('button', { name: 'List' }).click()
    await page.locator('[data-lesson-list]').getByRole('button', { name: 'Retry the deploy' }).click()
    const sheet = page.locator('[data-lesson-detail="sheet"]')
    await expect(sheet).toHaveAttribute('role', 'dialog')
    const box = await sheet.boundingBox()
    if (!box) throw new Error('sheet is missing')
    expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.y + box.height - 600)).toBeLessThanOrEqual(1)
    expect(box.height).toBeLessThan(600 * 0.62)
  })
}

test('header controls are 36px tall and every one shows the focus ring', async ({ page }) => {
  await openApp(page, pageState({ graph: graphWithNodes() }))
  for (const name of ['Sources', 'Settings']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(36)
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab')
    const focused = page.locator(':focus')
    await expect(focused).toHaveCSS('outline-style', 'solid')
    await expect(focused).toHaveCSS('outline-width', '2px')
  }
})

test('only Ask has the primary fill; the active page is marked with an underline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openApp(page, pageState({ graph: graphWithNodes() }))
  const filled = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('header button')]
        .filter((el) => getComputedStyle(el).backgroundColor === 'rgb(0, 120, 212)')
        .map((el) => (el as HTMLElement).innerText.trim()),
    )
  expect(await filled()).toEqual(['Ask'])
  await page.getByRole('button', { name: 'Settings' }).click()
  expect(await filled()).toEqual(['Ask'])
  const settings = page.getByRole('button', { name: 'Settings' })
  await expect(settings).toHaveAttribute('aria-pressed', 'true')
  await expect(settings.locator('[data-active-mark]')).toHaveCSS('background-color', 'rgb(61, 155, 255)')
  await settings.click()
  await expect(page.locator('[data-active-mark]')).toHaveCount(0)
})

test('a label near the right edge flips to the left of its dot and stays inside the map', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 600 })
  const graph = busyGraph()
  graph.nodes = graph.nodes.slice(0, 3).map((node, i) => ({ ...node, label: `a-rather-long-topic-label-${i}` }))
  await openApp(page, pageState({ graph }))
  await page.waitForFunction(() => !!window.__sharlieGraph?.screenCoords('tool:t2'))
  const labels = page.locator('[data-graph-label]')
  await expect(labels).toHaveCount(3)
  const result = await page.evaluate(() => {
    const frame = document.querySelector('[data-graph]')!.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('[data-graph-label]')].map((el) => {
      const box = el.getBoundingClientRect()
      return { inside: box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5, flipped: el.style.transform.includes('-100%') }
    })
  })
  expect(result.every((item) => item.inside)).toBe(true)
  expect(result.some((item) => item.flipped)).toBe(true)
})
