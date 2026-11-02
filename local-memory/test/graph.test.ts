import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openApp, type LessonDraft, type Transcript } from '../src/app.ts'
import { publishCard } from '../src/synapse.ts'
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

    const graph = app.graph()
    const labels = (kind: string) =>
      graph.nodes
        .filter((node) => node.kind === kind)
        .map((node) => node.label)
        .sort()
    assert.deepEqual(labels('developer'), ['ada'])
    assert.deepEqual(labels('team'), ['platform'])
    assert.deepEqual(labels('issue'), ['sharlie-evolved'])
    assert.deepEqual(labels('tool'), ['claude', 'cursor'])
    assert.deepEqual(labels('topic'), ['deploys', 'scratch'])
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
    const team = id('team', 'platform')
    assert.deepEqual(
      ends('Retry failed deploys'),
      [id('developer', 'ada'), team, id('issue', 'sharlie-evolved'), id('tool', 'cursor'), id('topic', 'deploys')].sort(),
    )
    assert.deepEqual(
      ends('My scratch note'),
      [id('developer', 'ada'), team, id('tool', 'claude'), id('topic', 'scratch')].sort(),
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
    app.setAutoDrop(true)
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

test('a shared author has a higher degree than one of its cards', () => {
  withDirectory((directory) => {
    const titles = ['Retry failed deploys', 'Read the lock log', 'Wait for the lock', 'Skip the broken job']
    for (const [index, title] of titles.entries()) {
      publishCard({
        directory,
        legacyId: `legacy-${index}`,
        autoDrop: false,
        drivePath: '',
        username: 'ada',
        card: {
          title,
          topics: [],
          context: { os: 'win32', tool_version: '', framework: '' },
          solution: title,
          failure_modes: [],
          relations: [],
          sources: ['cursor'],
          author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
        },
      })
    }

    const graph = openApp(directory).graph()
    const author = graph.nodes.find((node) => node.kind === 'developer')
    const card = graph.nodes.find((node) => node.kind === 'card')
    assert.ok(author)
    assert.ok(card)
    assert.ok((author.degree ?? 0) > (card.degree ?? 0))
  })
})

test('the graph keeps the zinc palette, and green is only the synced card color', () => {
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
    app.setAutoDrop(true)
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

    const shown = app.show(card.id)
    assert.equal(shown.kind, 'card')
    if (shown.kind !== 'card') return
    assert.deepEqual(shown, {
      kind: 'card',
      title: 'Retry failed deploys',
      solution: 'Retry the deploy once, then read the log.',
      failure_modes: [
        'A deploy failed after the lock timed out.',
        'The lock clears on its own within a minute.',
        'When a deploy fails on a lock, retry once before changing config.',
      ],
      created_at: shown.created_at,
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
    assert.deepEqual(show('team', 'platform'), {
      kind: 'team',
      name: 'platform',
      cards: ['My scratch note', 'Retry failed deploys'],
    })
    assert.deepEqual(show('topic', 'deploys'), {
      kind: 'topic',
      name: 'deploys',
      cards: ['Retry failed deploys'],
    })
  })
})

function cardNames(directory: string) {
  const folder = join(directory, 'cards')
  try {
    return readdirSync(folder).filter((name) => /^card_\d{8}_\d{6}(?:_\d+)?\.json$/.test(name))
  } catch {
    return []
  }
}

function savedCard(directory: string) {
  const names = cardNames(directory)
  assert.equal(names.length, 1)
  return JSON.parse(readFileSync(join(directory, 'cards', names[0]), 'utf8')) as {
    title: string
    topics?: string[]
    sources: string[]
    context?: { os: string; tool_version: string; framework: string }
    relations: { entity: string; relation: string; target_entity: string }[]
  }
}

test('a published card draws its labels and leaves file mentions and tool calls off the graph', () => {
  withDirectory((directory) => {
    publishCard({
      directory,
      legacyId: 'legacy-retry',
      autoDrop: false,
      drivePath: '',
      username: 'ada',
      card: {
        title: 'Retry failed deploys',
        topics: ['deploys'],
        context: { os: 'win32', tool_version: '', framework: 'sharlie-evolved' },
        solution: 'Retry the deploy once, then read the log.',
        failure_modes: ['A deploy failed after the lock timed out.'],
        relations: [
          { entity: 'Retry failed deploys', relation: 'modifies', target_entity: 'App.tsx' },
          { entity: 'Retry failed deploys', relation: 'defined_in', target_entity: 'index.css' },
          { entity: 'Retry failed deploys', relation: 'writes', target_entity: 'index.html' },
        ],
        sources: ['cursor', 'Read', 'Shell'],
        author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
      },
    })

    const graph = openApp(directory).graph()
    const labels = graph.nodes.map((node) => node.label)
    for (const label of ['App.tsx', 'index.css', 'index.html', 'Read', 'Shell']) {
      assert.equal(labels.includes(label), false, label)
    }
    for (const label of ['Retry failed deploys', 'ada', 'platform', 'deploys', 'sharlie-evolved', 'cursor']) {
      assert.equal(labels.includes(label), true, label)
    }
    const card = graph.nodes.find((node) => node.kind === 'card')
    assert.ok(card)
    assert.equal(card.relations == null || card.relations.length === 0, true)
  })
})

test('the learner stores learning sources, topics, and backup relations without file mentions', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        title: 'Retry failed deploys',
        topics: ['deploys'],
        sources: ['Read', 'Shell', 'cursor'],
        relations: [
          { entity: 'Retry failed deploys', relation: 'modifies', target_entity: 'App.tsx' },
          { entity: 'Retry failed deploys', relation: 'defined_in', target_entity: 'index.css' },
          { entity: 'Retry failed deploys', relation: 'writes', target_entity: 'index.html' },
        ],
      }),
    )
    app.runLearner([{ source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' }])

    const saved = savedCard(directory)
    assert.deepEqual(saved.relations, [
      { entity: 'Retry failed deploys', relation: 'APPLIES_TO', target_entity: 'cursor' },
      { entity: 'Retry failed deploys', relation: 'RESOLVES', target_entity: 'sharlie-evolved' },
    ])
    assert.deepEqual(saved.sources, ['cursor'])
    assert.deepEqual(saved.topics, ['deploys'])
    const markdown = readFileSync(join(directory, 'cards', cardNames(directory)[0].replace(/\.json$/, '.md')), 'utf8')
    assert.match(markdown, /^topics:\n  - deploys$/m)

    const graph = app.graph()
    const labels = graph.nodes.map((node) => node.label)
    for (const label of ['App.tsx', 'index.css', 'index.html', 'Read', 'Shell']) {
      assert.equal(labels.includes(label), false, label)
    }
    const id = (kind: string, label: string) => {
      const node = graph.nodes.find((item) => item.kind === kind && item.label === label)
      assert.ok(node, `${kind}:${label}`)
      return node.id
    }
    const card = id('card', 'Retry failed deploys')
    const ends = graph.links
      .filter((link) => link.source === card || link.target === card)
      .map((link) => (link.source === card ? link.target : link.source))
      .sort()
    assert.deepEqual(
      ends,
      [
        id('developer', 'ada'),
        id('team', 'platform'),
        id('issue', 'sharlie-evolved'),
        id('tool', 'cursor'),
        id('topic', 'deploys'),
      ].sort(),
    )
  })
})

test('a file-name title is not published and a lesson claim still is', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ title: 'index.css' }))
    app.runLearner([{ source: 'cursor', text: 'styles', repo: 'sharlie-evolved' }])
    assert.deepEqual(cardNames(directory), [])
  })
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ title: 'Retry failed deploys' }))
    app.runLearner([{ source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' }])
    assert.equal(savedCard(directory).title, 'Retry failed deploys')
  })
})

test('two lessons that share a topic share one topic node', () => {
  withDirectory((directory) => {
    const lessons: Record<string, LessonDraft> = {
      one: draft({ title: 'Retry failed deploys', topics: ['deploys'] }),
      two: draft({
        title: 'Read the lock log',
        topics: ['deploys'],
        summary: 'Read the log after one failed deploy.',
      }),
    }
    const app = ready(directory, (request) => lessons[request.transcript.text])
    app.runLearner([
      { source: 'cursor', text: 'one', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'two', repo: 'sharlie-evolved' },
    ])

    const graph = app.graph()
    const topics = graph.nodes.filter((node) => node.kind === 'topic' && node.label === 'deploys')
    assert.equal(topics.length, 1)
    const topic = topics[0]
    assert.ok(topic)
    const linked = graph.links
      .filter((link) => link.source === topic.id || link.target === topic.id)
      .map((link) => (link.source === topic.id ? link.target : link.source))
      .sort()
    const cardId = (label: string) => {
      const node = graph.nodes.find((item) => item.kind === 'card' && item.label === label)
      assert.ok(node)
      return node.id
    }
    assert.deepEqual(linked, [cardId('Read the lock log'), cardId('Retry failed deploys')].sort())
  })
})

test('the saved project is the repo, not the model framework or a RESOLVES target', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        title: 'Retry failed deploys',
        context: { os: 'win32', tool_version: '1', framework: 'React' },
        relations: [{ entity: 'Retry failed deploys', relation: 'RESOLVES', target_entity: 'React' }],
      }),
    )
    app.runLearner([{ source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' }])

    assert.equal(savedCard(directory).context?.framework, 'sharlie-evolved')
    const graph = app.graph()
    assert.deepEqual(
      graph.nodes.filter((node) => node.kind === 'issue').map((node) => node.label),
      ['sharlie-evolved'],
    )
    assert.equal(
      graph.nodes.some((node) => node.label === 'React'),
      false,
    )
  })
})
