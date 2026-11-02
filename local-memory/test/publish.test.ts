import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const transcript: Transcript = {
  source: 'cursor',
  text: 'the deploy failed after the lock timed out',
  repo: 'sharlie-evolved',
}

test('the person can set the Drive folder path and it is still there the next time the window opens', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    const app = openApp(directory)
    assert.equal(app.drivePath(), '')

    app.setDrivePath(drive)

    assert.equal(app.drivePath(), drive)
    assert.equal(openApp(directory).drivePath(), drive)
  })
})

test('an empty Drive path means the publisher does not run', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    app.runLearner([transcript])
    assert.equal(readdirSync(join(directory, 'cards')).some((name) => name.endsWith('.md')), true)

    assert.equal(app.runPublisher().ran, false)
    assert.equal(existsSync(join(directory, 'drive')), false)

    app.setDrivePath(join(directory, 'drive'))
    app.setDrivePath('')
    assert.equal(app.runPublisher().ran, false)
    assert.equal(existsSync(join(directory, 'drive')), false)
  })
})

test('sharing off writes a work card nowhere in the share folder', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    const app = ready(directory, () => draft())
    app.setDrivePath(drive)
    app.setAutoDrop(false)
    app.runLearner([transcript])
    assert.equal(app.runPublisher().ran, false)
    assert.equal(existsSync(drive), false)
    assert.equal(existsSync(join(drive, 'Dropzone')), false)
    const local = readdirSync(join(directory, 'cards')).filter((name) => name.endsWith('.json') && name !== '.claims.json')
    assert.equal(local.length, 1)
    const card = JSON.parse(readFileSync(join(directory, 'cards', local[0]), 'utf8')) as { scope?: string }
    assert.equal(card.scope, 'work')
  })
})

test('sharing on copies a work card and leaves personal and unscoped cards on this PC', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(drive)
    app.setAutoDrop(true)
    app.runLearner([
      { source: 'cursor', text: 'private scratch' },
    ])
    const cards = join(directory, 'cards')
    writeFileSync(
      join(cards, 'noscope.json'),
      JSON.stringify({
        id: 'noscope',
        title: 'No scope',
        topics: [],
        context: { os: '', tool_version: '', framework: '' },
        solution: 'stays here',
        failure_modes: [],
        relations: [],
        sources: [],
        created_at: '2024-01-01T00:00:00.000Z',
        author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
      }),
    )
    writeFileSync(join(cards, 'noscope.md'), 'No scope')
    assert.equal(app.runPublisher().ran, true)
    assert.equal(existsSync(join(drive, 'Dropzone')), false)

    app.runLearner([{ source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' }])
    const drop = join(drive, 'Dropzone', 'ada')
    const copied = readdirSync(drop)
    const jsonName = copied.find((name) => name.endsWith('.json'))
    const mdName = copied.find((name) => name.endsWith('.md'))
    assert.ok(jsonName)
    assert.ok(mdName)
    assert.equal(jsonName.replace(/\.json$/, ''), mdName.replace(/\.md$/, ''))
    const shared = JSON.parse(readFileSync(join(drop, jsonName), 'utf8')) as { scope?: string; title?: string }
    assert.equal(shared.scope, 'work')
    assert.equal(shared.title, 'Retry failed deploys')
    assert.equal(readFileSync(join(drop, mdName), 'utf8').includes('Retry failed deploys'), true)
    assert.equal(
      copied.some((name) => readFileSync(join(drop, name), 'utf8').includes('My scratch note')),
      false,
    )
    assert.equal(copied.includes('noscope.json') || copied.includes('noscope.md'), false)
    assert.equal(existsSync(join(drive, 'personal')), false)
  })
})

test('auto-drop copies the inbox file into Dropzone and then files it under cards', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    const app = ready(directory, () => draft())
    app.setDrivePath(drive)
    app.setAutoDrop(true)
    app.runLearner([transcript])
    const file = readdirSync(join(directory, 'cards')).find((name) => name.endsWith('.md'))
    assert.ok(file)
    assert.equal(readdirSync(join(directory, 'inbox')).length, 0)
    assert.deepEqual(
      readFileSync(join(drive, 'Dropzone', 'ada', file)),
      readFileSync(join(directory, 'cards', file)),
    )
    assert.equal(app.runPublisher().ran, true)
  })
})

test('publishing continues after the model key is removed', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    let modelCalls = 0
    const app = ready(directory, () => {
      modelCalls += 1
      return draft()
    })
    app.setDrivePath(drive)
    app.runLearner([transcript])
    const learned = modelCalls

    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      keys: unknown[]
    }
    settings.keys = []
    writeFileSync(join(directory, 'settings.json'), JSON.stringify(settings))

    const reopened = openApp(
      directory,
      () => {
        modelCalls += 1
        throw new Error('model')
      },
      machineWith(directory, ['cursor', 'claude']),
    )
    assert.throws(() => reopened.activeKey(), /No active key/)
    reopened.setAutoDrop(true)
    assert.equal(reopened.runPublisher().ran, true)
    assert.equal(modelCalls, learned)

    const file = readdirSync(join(directory, 'cards')).find((name) => name.endsWith('.md'))
    assert.ok(file)
    assert.deepEqual(
      readFileSync(join(drive, 'Dropzone', 'ada', file)),
      readFileSync(join(directory, 'cards', file)),
    )
  })
})
