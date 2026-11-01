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

test('auto-drop off leaves cards on the machine until the publisher copies them into Dropzone', () => {
  withDirectory((directory) => {
    const drive = join(directory, 'drive')
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
      'private scratch': { scope: 'personal', title: 'My scratch note' },
    }
    const app = ready(directory, (request) => draft(lessons[request.transcript.text]))
    app.setDrivePath(drive)
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])
    assert.equal(existsSync(drive), false)

    assert.equal(app.runPublisher().ran, true)
    const drop = join(drive, 'Dropzone', 'ada')
    const local = readdirSync(join(directory, 'cards')).filter((name) => name.endsWith('.md') || name.endsWith('.json'))
    for (const name of local) {
      if (name === '.claims.json') continue
      assert.deepEqual(readFileSync(join(drop, name)), readFileSync(join(directory, 'cards', name)))
    }
    assert.equal(existsSync(join(drive, 'personal')), false)
    assert.equal(existsSync(join(drive, 'platform')), false)
    assert.equal(
      readdirSync(drop).some((name) => readFileSync(join(drop, name), 'utf8').includes('My scratch note')),
      true,
    )
    assert.equal(
      readdirSync(drop).some((name) => readFileSync(join(drop, name), 'utf8').includes('Retry failed deploys')),
      true,
    )
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
