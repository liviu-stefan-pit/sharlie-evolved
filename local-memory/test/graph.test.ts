import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
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
    assert.deepEqual(labels('developer'), ['ada'])
    assert.deepEqual(labels('issue'), ['sharlie-evolved'])
    assert.deepEqual(labels('tool'), ['claude', 'cursor'])
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
      [id('developer', 'ada'), id('issue', 'sharlie-evolved'), id('tool', 'cursor')].sort(),
    )
    assert.deepEqual(ends('My scratch note'), [id('developer', 'ada'), id('tool', 'claude')].sort())
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
    assert.equal(synced('My scratch note'), true)
  })
})

test('the graph uses the zinc palette, and green only on a synced card', () => {
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
    assert.equal(graph.canvas, '#1f1f1f')
    assert.equal(graph.panel, '#252526')
    assert.equal(graph.text, '#cccccc')
    assert.equal(graph.accent, '#5c5c5c')
    assert.equal(
      graph.nodes.find((node) => node.label === 'Retry failed deploys')?.color,
      '#6f8f78',
    )
    for (const node of graph.nodes) {
      assert.equal(node.color, node.synced ? '#6f8f78' : node.kind === 'card' ? '#b89a6a' : '#9d9d9d')
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
      solution: 'Retry the deploy once, then read the log.',
      failure_modes: [
        'A deploy failed after the lock timed out.',
        'The lock clears on its own within a minute.',
        'When a deploy fails on a lock, retry once before changing config.',
      ],
      created_at: app.show(card.id).created_at,
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

    assert.deepEqual(show('developer', 'ada'), {
      kind: 'developer',
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
      cards: ['My scratch note', 'Retry failed deploys'],
    })
    assert.deepEqual(show('issue', 'sharlie-evolved'), {
      kind: 'issue',
      name: 'sharlie-evolved',
      cards: ['Retry failed deploys'],
    })
    assert.deepEqual(show('tool', 'cursor'), {
      kind: 'tool',
      name: 'cursor',
      cards: ['Retry failed deploys'],
    })
    assert.deepEqual(show('tool', 'claude'), {
      kind: 'tool',
      name: 'claude',
      cards: ['My scratch note'],
    })
  })
})
