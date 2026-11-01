import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openApp, openUserSession, readInstalledTranscripts, type LessonDraft, type Transcript } from '../src/app.ts'
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

function draft(title: string): LessonDraft {
  return {
    scope: 'work',
    title,
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
  }
}

function ready(directory: string, complete: (request: { transcript: Transcript; transcripts: Transcript[] }) => LessonDraft) {
  const app = openApp(directory, complete, machineWith(directory, ['cursor', 'claude']))
  app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  return app
}

test('the first learner run imports every existing transcript from the enabled tools, newest first', () => {
  withDirectory((directory) => {
    const seen: string[] = []
    const app = ready(directory, (request) => {
      seen.push(request.transcript.text)
      return draft(request.transcript.text)
    })
    app.runLearner([
      {
        id: 'older',
        source: 'cursor',
        text: 'older chat',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'newer',
        source: 'claude',
        text: 'newer chat',
        changedAt: '2024-01-01T00:00:00.000Z',
      },
    ])
    assert.deepEqual(seen, ['newer chat', 'older chat'])
    const folder = join(directory, 'cards')
    const cards = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(cards.some((card) => card.includes('title: newer chat')), true)
    assert.equal(cards.some((card) => card.includes('title: older chat')), true)
  })
})

test('a long history is imported in batches, back to back, and not as one model call', () => {
  withDirectory((directory) => {
    const history: Transcript[] = Array.from({ length: 11 }, (_, index) => ({
      id: `chat-${index}`,
      source: 'cursor',
      text: `chat ${index}`,
      changedAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
      repo: 'sharlie-evolved',
    }))
    const calls: string[][] = []
    const app = ready(directory, (request) => {
      calls.push(request.transcripts.map((item) => item.text))
      return draft(request.transcript.text)
    })
    app.runLearner(history)
    const batches: string[][] = []
    for (const call of calls) {
      const previous = batches[batches.length - 1]
      if (!previous || previous.join('\n') !== call.join('\n')) batches.push(call)
    }
    const newestFirst = [...history].reverse().map((item) => item.text)
    assert.ok(batches.length > 1)
    assert.equal(
      batches.every((batch) => batch.length < history.length),
      true,
    )
    assert.deepEqual(batches.flat(), newestFirst)
    const folder = join(directory, 'cards')
    const titles = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    for (const item of history) {
      assert.equal(
        titles.some((card) => card.includes(`title: ${item.text}`)),
        true,
      )
    }
  })
})

test('a later run does not reread history that was already imported successfully', () => {
  withDirectory((directory) => {
    const history: Transcript[] = [
      {
        id: 'older',
        source: 'cursor',
        text: 'older chat',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'newer',
        source: 'claude',
        text: 'newer chat',
        changedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    let calls = 0
    const complete = () => {
      calls += 1
      return draft('Retry failed deploys')
    }
    const machine = machineWith(directory, ['cursor', 'claude'])
    const app = openApp(directory, complete, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner(history)
    assert.equal(calls, history.length)
    openApp(directory, complete, machine).runLearner(history)
    assert.equal(calls, history.length)
  })
})

test('a run before the profile and active key does not import, and the first ready run still imports newest first', () => {
  withDirectory((directory) => {
    const history: Transcript[] = [
      {
        id: 'older',
        source: 'cursor',
        text: 'older chat',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'newer',
        source: 'claude',
        text: 'newer chat',
        changedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    const seen: string[] = []
    const machine = machineWith(directory, ['cursor', 'claude'])
    const app = openApp(
      directory,
      (request) => {
        seen.push(request.transcript.text)
        return draft(request.transcript.text)
      },
      machine,
    )
    assert.equal(app.runLearner(history).ran, false)
    assert.deepEqual(seen, [])
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner(history)
    assert.deepEqual(seen, ['newer chat', 'older chat'])
  })
})

test('transcripts that arrived while the machine was off are picked up, and imported history is not', () => {
  withDirectory((directory) => {
    const history: Transcript[] = [
      {
        id: 'older',
        source: 'cursor',
        text: 'older chat',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'newer',
        source: 'claude',
        text: 'newer chat',
        changedAt: '2024-01-01T00:00:00.000Z',
      },
    ]
    const seen: string[] = []
    const batches: string[][] = []
    const machine = machineWith(directory, ['cursor', 'claude'])
    const complete = (request: { transcript: Transcript; transcripts: Transcript[] }) => {
      seen.push(request.transcript.text)
      batches.push(request.transcripts.map((item) => item.text))
      return draft(request.transcript.text)
    }
    const app = openApp(directory, complete, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner(history)
    seen.length = 0
    batches.length = 0
    openApp(directory, complete, machine).runLearner([
      ...history,
      {
        id: 'while-off',
        source: 'cursor',
        text: 'arrived while off',
        changedAt: '2025-06-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'while-off-later',
        source: 'claude',
        text: 'arrived later',
        changedAt: '2025-07-01T00:00:00.000Z',
      },
    ])
    assert.deepEqual(seen, ['arrived later', 'arrived while off'])
    assert.deepEqual(batches, [
      ['arrived later', 'arrived while off'],
      ['arrived later', 'arrived while off'],
    ])
  })
})

test('a later run reads a transcript that changed since the last success and skips the ones that did not', () => {
  withDirectory((directory) => {
    const older: Transcript = {
      id: 'older',
      source: 'cursor',
      text: 'older chat',
      changedAt: '2020-01-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    }
    const newer: Transcript = {
      id: 'newer',
      source: 'claude',
      text: 'newer chat',
      changedAt: '2024-01-01T00:00:00.000Z',
    }
    const seen: string[] = []
    const machine = machineWith(directory, ['cursor', 'claude'])
    const complete = (request: { transcript: Transcript; transcripts: Transcript[] }) => {
      seen.push(request.transcripts.map((item) => item.text).join('|'))
      return draft(request.transcript.text)
    }
    const app = openApp(directory, complete, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner([older, newer])
    seen.length = 0
    openApp(directory, complete, machine).runLearner([
      older,
      { ...newer, text: 'newer chat edited', changedAt: '2025-01-01T00:00:00.000Z' },
    ])
    assert.deepEqual(seen, ['newer chat edited'])
  })
})

function jsonl(lines: { role: 'user' | 'assistant'; text: string }[]) {
  return lines
    .map((line) =>
      JSON.stringify({ role: line.role, message: { content: [{ type: 'text', text: line.text }] } }),
    )
    .join('\n')
}

test('start learning reads installed transcript files, including an old Cursor chat, and the next run skips them', () => {
  const root = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const directory = join(root, 'knowledge')
  const machine = machineWith(root, ['cursor', 'cursor-cli', 'claude-cli'])
  const cursorFile = join(
    machine.home,
    '.cursor',
    'projects',
    'sharlie-evolved',
    'agent-transcripts',
    'chat',
    'chat.jsonl',
  )
  const cliFile = join(machine.home, '.cursor', 'chats', 'cli-session', 'session.jsonl')
  const claudeFile = join(machine.home, '.claude', 'projects', 'ledger', 'session.jsonl')
  mkdirSync(join(cursorFile, '..'), { recursive: true })
  mkdirSync(join(cliFile, '..'), { recursive: true })
  mkdirSync(join(claudeFile, '..'), { recursive: true })
  writeFileSync(cursorFile, jsonl([
    { role: 'user', text: 'retry the deploy' },
    { role: 'assistant', text: 'Read the log.' },
  ]))
  writeFileSync(cliFile, jsonl([{ role: 'user', text: 'the cli fixed the lock' }]))
  writeFileSync(claudeFile, jsonl([{ role: 'user', text: 'name the export header' }]))
  const old = new Date('2024-01-15T12:00:00.000Z')
  utimesSync(cursorFile, old, old)
  utimesSync(cliFile, new Date('2024-06-01T12:00:00.000Z'), new Date('2024-06-01T12:00:00.000Z'))
  utimesSync(claudeFile, new Date('2025-01-01T12:00:00.000Z'), new Date('2025-01-01T12:00:00.000Z'))

  const seen: string[] = []
  const session = openUserSession(
    'ada',
    (request) => {
      seen.push(`${request.transcript.source}:${request.transcript.text}`)
      return draft(request.transcript.text)
    },
    machine,
    () => readInstalledTranscripts(machine),
  )
  try {
    const found = readInstalledTranscripts(machine)
    const cursor = found.find((transcript) => transcript.source === 'cursor')
    assert.ok(cursor)
    assert.equal(cursor.repo, 'sharlie-evolved')
    assert.equal(cursor.id, cursorFile)
    assert.equal(cursor.text, 'retry the deploy\nRead the log.')
    assert.ok(Date.parse(cursor.changedAt ?? '') < Date.parse('2024-06-01T00:00:00.000Z'))
    assert.equal(found.filter((transcript) => transcript.id === cursorFile).length, 1)
    assert.equal(found.some((transcript) => transcript.source === 'cursor-cli' && transcript.text === 'the cli fixed the lock'), true)
    assert.equal(found.some((transcript) => transcript.source === 'claude-cli' && transcript.repo === 'ledger'), true)

    const window = session.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    assert.equal(window.startLearning(), '')
    assert.deepEqual(seen, [
      'claude-cli:name the export header',
      'cursor-cli:the cli fixed the lock',
      'cursor:retry the deploy\nRead the log.',
    ])
    assert.equal(
      readdirSync(join(directory, 'cards')).some((file) =>
        file.endsWith('.md') && readFileSync(join(directory, 'cards', file), 'utf8').includes('retry the deploy'),
      ),
      true,
    )

    seen.length = 0
    session.logIn()
    session.install(directory)
    session.pass(60 * 60 * 1000)
    assert.deepEqual(seen, [])

    const later = join(machine.home, '.cursor', 'projects', 'sharlie-evolved', 'agent-transcripts', 'later', 'later.jsonl')
    mkdirSync(join(later, '..'), { recursive: true })
    writeFileSync(later, jsonl([{ role: 'user', text: 'read the lock log' }]))
    utimesSync(later, new Date('2026-02-01T12:00:00.000Z'), new Date('2026-02-01T12:00:00.000Z'))
    session.pass(60 * 60 * 1000)
    assert.deepEqual(seen, ['cursor:read the lock log'])
  } finally {
    discardVault(directory)
    rmSync(root, { recursive: true, force: true })
  }
})

test('a transcript from an installed tool is imported even when that tool was turned off', () => {
  withDirectory((directory) => {
    const seen: string[] = []
    const machine = machineWith(directory, ['cursor', 'claude'])
    const complete = (request: { transcript: Transcript }) => {
      seen.push(request.transcript.text)
      return draft(request.transcript.text)
    }
    const app = openApp(directory, complete, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.setToolEnabled('Claude', false)
    app.runLearner([
      {
        id: 'cursor-old',
        source: 'cursor',
        text: 'cursor history',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'claude-old',
        source: 'claude',
        text: 'claude history',
        changedAt: '2021-01-01T00:00:00.000Z',
      },
    ])
    assert.deepEqual(seen, ['claude history', 'cursor history'])
    seen.length = 0
    openApp(directory, complete, machine).runLearner([
      {
        id: 'cursor-old',
        source: 'cursor',
        text: 'cursor history',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
      {
        id: 'claude-old',
        source: 'claude',
        text: 'claude history edited',
        changedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'cursor-new',
        source: 'cursor',
        text: 'cursor follow-up',
        changedAt: '2025-02-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      },
    ])
    assert.deepEqual(seen, ['cursor follow-up', 'claude history edited'])
    const folder = join(directory, 'cards')
    const cards = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(cards.some((card) => card.includes('claude history')), true)
  })
})
