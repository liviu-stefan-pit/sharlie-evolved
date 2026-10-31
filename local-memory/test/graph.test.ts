import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { discardVault, openApp, type LessonDraft, type Transcript } from '../src/app.ts'
import { machineWith } from './machine.ts'

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  try {
    run(directory)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
}

function draft(overrides: Partial<LessonDraft> = {}): LessonDraft {
  return {
    scope: 'work',
    title: 'Retry failed deploys',
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: 'A deploy failed after the lock timed out.',
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    otherNames: [],
    belongsToProject: null,
    clearlyOneProduct: true,
    subjectProject: null,
    generalTechnique: false,
    ...overrides,
  }
}

function ready(directory: string, complete: (request: { transcript: Transcript }) => LessonDraft) {
  const app = openApp(directory, complete, machineWith(directory, ['cursor', 'claude']))
  app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  return app
}

test('the graph draws the whole local folder, personal cards and work cards', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])

    const titles = app
      .graph()
      .nodes.filter((node) => node.kind === 'card')
      .map((node) => node.label)
      .sort()
    assert.deepEqual(titles, ['My scratch note', 'Retry failed deploys'])
  })
})

test('the graph links each card to its person, team, project, source, and topic', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': {
        scope: 'work',
        title: 'Retry failed deploys',
        topics: ['deploys'],
        sources: ['cursor'],
      },
      'private scratch': {
        scope: 'personal',
        title: 'My scratch note',
        topics: ['deploys'],
        sources: ['claude'],
        clearlyOneProduct: false,
        generalTechnique: true,
      },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'private scratch' },
    ])

    const graph = app.graph()
    const labels = (kind: string) =>
      graph.nodes
        .filter((node) => node.kind === kind)
        .map((node) => node.label)
        .sort()
    assert.deepEqual(labels('person'), ['ada'])
    assert.deepEqual(labels('team'), ['platform'])
    assert.deepEqual(labels('project'), ['none', 'sharlie-evolved'])
    assert.deepEqual(labels('source'), ['claude', 'cursor'])
    assert.deepEqual(labels('topic'), ['deploys'])
    assert.deepEqual(labels('card'), ['My scratch note', 'Retry failed deploys'])

    const id = (kind: string, label: string) => {
      const node = graph.nodes.find((item) => item.kind === kind && item.label === label)
      assert.ok(node)
      return node.id
    }
    const ends = (label: string) => {
      const card = id('card', label)
      return graph.links
        .filter((link) => link.source === card || link.target === card)
        .map((link) => (link.source === card ? link.target : link.source))
        .sort()
    }
    assert.deepEqual(
      ends('Retry failed deploys'),
      [
        id('person', 'ada'),
        id('project', 'sharlie-evolved'),
        id('source', 'cursor'),
        id('team', 'platform'),
        id('topic', 'deploys'),
      ].sort(),
    )
    assert.deepEqual(
      ends('My scratch note'),
      [
        id('person', 'ada'),
        id('project', 'none'),
        id('source', 'claude'),
        id('team', 'platform'),
        id('topic', 'deploys'),
      ].sort(),
    )
  })
})

test('a card that has not been copied does not show as synced', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(join(directory, 'drive'))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])

    const synced = (label: string) => {
      const node = app.graph().nodes.find((item) => item.kind === 'card' && item.label === label)
      assert.ok(node)
      return node.synced
    }
    assert.equal(synced('Retry failed deploys'), false)
    assert.equal(synced('My scratch note'), false)
  })
})

test('a work card the publisher has copied shows as synced', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(join(directory, 'drive'))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])
    app.runPublisher()

    const synced = (label: string) => {
      const node = app.graph().nodes.find((item) => item.kind === 'card' && item.label === label)
      assert.ok(node)
      return node.synced
    }
    assert.equal(synced('Retry failed deploys'), true)
    assert.equal(synced('My scratch note'), false)
  })
})

test('the graph uses the Nord palette, and green only on a synced card', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(join(directory, 'drive'))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])
    app.runPublisher()

    const graph = app.graph()
    assert.equal(graph.canvas, '#2e3440')
    assert.equal(graph.panel, '#3b4252')
    assert.equal(graph.text, '#eceff4')
    assert.equal(graph.accent, '#88c0d0')
    assert.equal(
      graph.nodes.find((node) => node.label === 'Retry failed deploys')?.color,
      '#a3be8c',
    )
    for (const node of graph.nodes) {
      assert.equal(node.color, node.synced ? '#a3be8c' : '#88c0d0')
    }
  })
})

test('clicking a card shows the lesson in it', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    app.runLearner([{ source: 'cursor', text: 'the deploy failed after the lock timed out', repo: 'sharlie-evolved' }])
    const card = app.graph().nodes.find((node) => node.kind === 'card' && node.label === 'Retry failed deploys')
    assert.ok(card)

    assert.deepEqual(app.show(card.id), {
      kind: 'card',
      title: 'Retry failed deploys',
      summary: 'Retry a failed deploy once.',
      situation: 'A deploy failed after the lock timed out.',
      whatToDo: 'Retry the deploy once, then read the log.',
      why: 'The lock clears on its own within a minute.',
      apply: 'When a deploy fails on a lock, retry once before changing config.',
      synced: false,
    })
  })
})

test('clicking a person, team, project, source, or topic shows the cards in it', () => {
  withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': {
        scope: 'work',
        title: 'Retry failed deploys',
        topics: ['deploys'],
        sources: ['cursor'],
      },
      'private scratch': {
        scope: 'personal',
        title: 'My scratch note',
        topics: ['scratch'],
        sources: ['claude'],
        clearlyOneProduct: false,
        generalTechnique: true,
      },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'private scratch' },
    ])
    const show = (kind: string, label: string) => {
      const node = app.graph().nodes.find((item) => item.kind === kind && item.label === label)
      assert.ok(node)
      return app.show(node.id)
    }

    assert.deepEqual(show('person', 'ada'), {
      kind: 'person',
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
      cards: ['My scratch note', 'Retry failed deploys'],
    })
    assert.deepEqual(show('team', 'platform'), {
      kind: 'team',
      name: 'platform',
      cards: ['My scratch note', 'Retry failed deploys'],
    })
    assert.deepEqual(show('project', 'sharlie-evolved'), {
      kind: 'project',
      name: 'sharlie-evolved',
      cards: ['Retry failed deploys'],
    })
    assert.deepEqual(show('project', 'none'), {
      kind: 'project',
      name: 'none',
      cards: ['My scratch note'],
    })
    assert.deepEqual(show('source', 'cursor'), {
      kind: 'source',
      name: 'cursor',
      cards: ['Retry failed deploys'],
    })
    assert.deepEqual(show('topic', 'deploys'), {
      kind: 'topic',
      name: 'deploys',
      cards: ['Retry failed deploys'],
    })
  })
})

test('the window draws the graph with force-graph and shows the clicked node', async () => {
  const mounted: {
    element: { style: { background: string; color: string } }
    background?: string
    nodeColorFn?: (node: { color: string }) => string
    linkColorFn?: () => string
    click?: (node: { id: string }) => void
    data?: { nodes: unknown[]; links: unknown[] }
  }[] = []
  class FakeForceGraph {
    element: { style: { background: string; color: string } }
    background?: string
    nodeColorFn?: (node: { color: string }) => string
    linkColorFn?: () => string
    click?: (node: { id: string }) => void
    data?: { nodes: unknown[]; links: unknown[] }
    constructor(element: { style: { background: string; color: string } }) {
      this.element = element
      mounted.push(this)
    }
    width() {
      return this
    }
    height() {
      return this
    }
    backgroundColor(color?: string) {
      if (color === undefined) return this.background
      this.background = color
      return this
    }
    nodeColor(fn: (node: { color: string }) => string) {
      this.nodeColorFn = fn
      return this
    }
    nodeLabel() {
      return this
    }
    nodeCanvasObject() {
      return this
    }
    nodePointerAreaPaint() {
      return this
    }
    linkColor(fn: () => string) {
      this.linkColorFn = fn
      return this
    }
    onNodeClick(fn: (node: { id: string }) => void) {
      this.click = fn
      return this
    }
    graphData(data: { nodes: unknown[]; links: unknown[] }) {
      this.data = data
      return this
    }
  }
  mock.module('force-graph', { exports: { default: FakeForceGraph } })
  const { mountGraph } = await import('../src/graph-window.ts')

  await withDirectory((directory) => {
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(join(directory, 'drive'))
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])
    app.runPublisher()
    const graph = app.graph()
    const root = fakeWindow()
    mountGraph(root as unknown as HTMLElement, directory, machineWith(directory, ['cursor', 'claude']))

    const chart = mounted[0]
    assert.ok(chart)
    assert.equal(chart.background, '#2e3440')
    assert.equal(root.style.background, '#2e3440')
    const panel = root.children.find((child) => child !== chart.element)
    assert.ok(panel)
    assert.equal(panel.style.background, '#3b4252')
    assert.equal(panel.style.color, '#eceff4')
    const work = graph.nodes.find((node) => node.label === 'Retry failed deploys')
    const personal = graph.nodes.find((node) => node.label === 'My scratch note')
    assert.ok(work && personal && chart.nodeColorFn && chart.linkColorFn && chart.click)
    assert.equal(chart.nodeColorFn(work), '#a3be8c')
    assert.equal(chart.nodeColorFn(personal), '#88c0d0')
    assert.equal(chart.linkColorFn(), '#88c0d0')
    assert.equal(chart.data?.nodes.length, graph.nodes.length)
    assert.equal(chart.data?.links.length, graph.links.length)

    chart.click(work)
    assert.equal(
      panel.textContent,
      [
        'Retry failed deploys',
        'synced',
        'Retry a failed deploy once.',
        'Situation',
        'A deploy failed after the lock timed out.',
        'What to do',
        'Retry the deploy once, then read the log.',
        'Why',
        'The lock clears on its own within a minute.',
        'How someone who was not in the chat applies it',
        'When a deploy fails on a lock, retry once before changing config.',
      ].join('\n'),
    )

    const topic = graph.nodes.find((node) => node.kind === 'topic' && node.label === 'deploys')
    assert.ok(topic)
    chart.click(topic)
    assert.equal(panel.textContent, ['deploys', 'My scratch note', 'Retry failed deploys'].join('\n'))
  })
})

function fakeWindow() {
  function pane() {
    return {
      style: { background: '', color: '' },
      dataset: {} as Record<string, string>,
      textContent: '',
    }
  }
  const root = {
    style: { background: '' },
    innerHTML: '',
    children: [] as ReturnType<typeof pane>[],
    ownerDocument: { createElement: pane },
    append(...children: ReturnType<typeof pane>[]) {
      this.children.push(...children)
    },
  }
  return root
}
