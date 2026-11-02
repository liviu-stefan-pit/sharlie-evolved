import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openUserSession, type LessonDraft, type Transcript } from '../src/app.ts'
import { runningUnderTest } from '../src/login-item.ts'
import { machineWith } from './machine.ts'

const hour = 60 * 60 * 1000

function draft(title: string, scope: LessonDraft['scope'] = 'work'): LessonDraft {
  return {
    scope,
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

function withPerson(
  person: string,
  run: (
    session: ReturnType<typeof openUserSession>,
    directory: string,
    transcripts: Transcript[],
  ) => void,
  complete: (request: { transcript: Transcript }) => LessonDraft = (request) => draft(request.transcript.text),
) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const transcripts: Transcript[] = []
  const session = openUserSession(person, complete, machineWith(directory, ['cursor']), () => transcripts)
  try {
    run(session, directory, transcripts)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
}

function prepare(session: ReturnType<typeof openUserSession>, directory: string, drive: string) {
  const window = session.openWindow(directory)
  window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  window.setDrivePath(drive)
  window.setAutoDrop(true)
  window.startLearning()
  window.close()
  return window
}

function cardFiles(folder: string) {
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter((name) => name.endsWith('.md'))
}

function plantWorkNote(folder: string, body: string) {
  writeFileSync(join(folder, 'extra-note.md'), body)
  writeFileSync(
    join(folder, 'extra-note.json'),
    JSON.stringify({
      id: 'extra-note',
      title: body,
      scope: 'work',
      topics: [],
      context: { os: '', tool_version: '', framework: '' },
      solution: body,
      failure_modes: [],
      relations: [],
      sources: ['cursor'],
      created_at: '2024-01-01T00:00:00.000Z',
      author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
}

test('unit tests skip the operating system login item', () => {
  assert.equal(runningUnderTest(), true)
})

test('manual cadence does not tick, and sync now runs one learner pass and one publish pass', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    const window = prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)
    window.setLearnerInterval(0)
    window.setPublisherInterval(0)
    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const folder = join(directory, 'cards')
    plantWorkNote(folder, 'a work card added while manual')
    ada.pass(hour)
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)

    ada.syncNow()
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(readFileSync(join(drive, 'Dropzone', 'ada', 'extra-note.md'), 'utf8'), 'a work card added while manual')
  })
})

test('pause harvest stops the clock and leaves the registered jobs in place', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)
    ada.pauseHarvest()
    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.pass(hour)
    const folder = join(directory, 'cards')
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )
    ada.resumeHarvest()
    ada.pass(30 * 60 * 1000)
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
  })
})

test('installing registers the learner and the publisher, and both run with the window closed', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })

    ada.pass(hour)
    assert.deepEqual(cardFiles(join(directory, 'cards')), [])
    assert.equal(existsSync(drive), false)

    ada.install(directory)

    const folder = join(directory, 'cards')
    const files = cardFiles(folder)
    assert.equal(files.length, 1)
    const local = readFileSync(join(folder, files[0]))
    assert.equal(local.toString().includes('title: retry the deploy'), true)
    assert.deepEqual(readFileSync(join(drive, 'Dropzone', 'ada', files[0])), local)
  })
})

test('uninstalling unregisters both jobs, and neither keeps running', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const folder = join(directory, 'cards')
    writeFileSync(join(folder, 'extra-note.md'), 'a work card added after uninstall')
    ada.uninstall(directory)
    ada.pass(hour)
    ada.logOut()
    ada.logIn()

    const files = cardFiles(folder).filter((file) => file !== 'extra-note.md')
    assert.equal(files.length, 1)
    assert.equal(readFileSync(join(folder, files[0]), 'utf8').includes('read the lock log'), false)
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)
    assert.equal(cardFiles(join(drive, 'Dropzone', 'ada')).includes('extra-note.md'), false)
  })
})

test('the window can register both jobs', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    const window = ada.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    window.setDrivePath(drive)
    window.setAutoDrop(true)
    window.startLearning()
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })

    window.registerJobs()
    window.close()

    const folder = join(directory, 'cards')
    const files = cardFiles(folder)
    assert.equal(files.length, 1)
    const local = readFileSync(join(folder, files[0]))
    assert.equal(local.toString().includes('title: retry the deploy'), true)
    assert.deepEqual(readFileSync(join(drive, 'Dropzone', 'ada', files[0])), local)
  })
})

test('the window can unregister both jobs and pause the system without uninstalling', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)

    const window = ada.openWindow(directory)
    window.unregisterJobs()
    window.close()
    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const folder = join(directory, 'cards')
    plantWorkNote(folder, 'a work card added while paused')
    ada.pass(hour)
    ada.logOut()
    ada.logIn()

    assert.equal(cardFiles(folder).includes('extra-note.md'), true)
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)

    const resumed = ada.openWindow(directory)
    resumed.registerJobs()
    resumed.close()

    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      readFileSync(join(drive, 'Dropzone', 'ada', 'extra-note.md'), 'utf8'),
      'a work card added while paused',
    )
  })
})

test('the jobs start when the person logs in and stop when they log out', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)
    ada.pass(hour)

    const folder = join(directory, 'cards')
    assert.deepEqual(cardFiles(folder), [])
    assert.equal(existsSync(drive), false)

    ada.logIn()
    const files = cardFiles(folder)
    assert.equal(files.length, 1)
    assert.deepEqual(readFileSync(join(drive, 'Dropzone', 'ada', files[0])), readFileSync(join(folder, files[0])))

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    plantWorkNote(folder, 'a work card added after logout')
    ada.logOut()
    ada.pass(hour)

    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)

    ada.logIn()
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      readFileSync(join(drive, 'Dropzone', 'ada', 'extra-note.md'), 'utf8'),
      'a work card added after logout',
    )
  })
})

test('the jobs stop when the machine shuts down', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const folder = join(directory, 'cards')
    plantWorkNote(folder, 'a work card added after shutdown')
    ada.shutDown()
    ada.pass(hour)

    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)

    ada.logIn()
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      readFileSync(join(drive, 'Dropzone', 'ada', 'extra-note.md'), 'utf8'),
      'a work card added after shutdown',
    )
  })
})

test("the jobs run only in that person's session", () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const transcripts: Transcript[] = []
  const machine = machineWith(directory, ['cursor'])
  const complete = (request: { transcript: Transcript }) => draft(request.transcript.text)
  const ada = openUserSession('ada', complete, machine, () => transcripts)
  try {
    const drive = join(directory, 'drive')
    ada.logIn()
    prepare(ada, directory, drive)
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)
    ada.logOut()

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const bob = openUserSession('bob', complete, machine, () => transcripts)
    bob.logIn()
    bob.openWindow(directory).close()
    bob.pass(hour)

    const folder = join(directory, 'cards')
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )

    openUserSession('ada', complete, machine, () => transcripts).logIn()
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('opening or closing the window leaves the jobs as they are', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    const profile = { username: 'ada', email: 'ada@example.com', team: 'platform' }
    const setup = ada.openWindow(directory)
    setup.saveProfile(profile)
    setup.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    setup.setDrivePath(drive)
    setup.setAutoDrop(true)
    setup.startLearning()
    ada.install(directory)
    setup.close()
    assert.deepEqual(cardFiles(join(directory, 'cards')), [])
    assert.equal(existsSync(drive), false)

    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    const window = ada.openWindow(directory)
    ada.logIn()
    const folder = join(directory, 'cards')
    const first = cardFiles(folder)
    assert.equal(first.length, 1)
    assert.equal(existsSync(join(drive, 'Dropzone', 'ada', first[0])), true)

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    window.saveProfile(profile)
    window.close()
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )

    ada.pass(hour)
    const learned = cardFiles(folder).filter((file) =>
      readFileSync(join(folder, file), 'utf8').includes('title: retry the deploy'),
    )
    assert.equal(learned.length, 1)
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      cardFiles(join(drive, 'Dropzone', 'ada')).some((file) =>
        readFileSync(join(drive, 'Dropzone', 'ada', file), 'utf8').includes('title: read the lock log'),
      ),
      true,
    )
  })
})

test('the learner job imports history newest first, then reads only what changed', () => {
  const seen: string[] = []
  withPerson(
    'ada',
    (ada, directory, transcripts) => {
      const drive = join(directory, 'drive')
      ada.logIn()
      prepare(ada, directory, drive)
      const older = {
        id: 'older',
        source: 'cursor',
        text: 'older chat',
        changedAt: '2020-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      }
      transcripts.push(older, {
        id: 'newer',
        source: 'cursor',
        text: 'newer chat',
        changedAt: '2024-01-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      })
      ada.install(directory)
      assert.deepEqual(seen, ['newer chat', 'older chat'])

      seen.length = 0
      ada.pass(hour)
      assert.deepEqual(seen, [])

      older.text = 'older chat revised'
      older.changedAt = '2025-01-01T00:00:00.000Z'
      ada.pass(hour)
      assert.deepEqual(seen, ['older chat revised'])
      const folder = join(directory, 'cards')
      const titles = cardFiles(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
      assert.equal(titles.some((card) => card.includes('title: newer chat')), true)
      assert.equal(titles.some((card) => card.includes('title: older chat revised')), true)
    },
    (request) => {
      seen.push(request.transcript.text)
      return draft(request.transcript.text)
    },
  )
})

test('the publisher job copies work cards and leaves personal cards on the machine', () => {
  withPerson(
    'ada',
    (ada, directory, transcripts) => {
      const drive = join(directory, 'drive')
      ada.logIn()
      const window = ada.openWindow(directory)
      window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
      window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
      window.setDrivePath(drive)
      window.setAutoDrop(true)
      window.setPublisherInterval(hour)
      window.startLearning()
      window.close()
      transcripts.push(
        {
          id: 'work',
          source: 'cursor',
          text: 'retry the deploy',
          changedAt: '2024-06-01T00:00:00.000Z',
          repo: 'sharlie-evolved',
        },
        {
          id: 'personal',
          source: 'cursor',
          text: 'my scratch note',
          changedAt: '2024-06-02T00:00:00.000Z',
        },
      )
      ada.install(directory)

      const work = join(directory, 'cards')
      const drop = join(drive, 'Dropzone', 'ada')
      assert.equal(
        cardFiles(work).some((file) => readFileSync(join(work, file), 'utf8').includes('title: my scratch note')),
        true,
      )
      assert.equal(existsSync(join(drive, 'personal')), false)
      assert.equal(
        cardFiles(drop).some((file) => readFileSync(join(drop, file), 'utf8').includes('title: retry the deploy')),
        true,
      )
      assert.equal(
        cardFiles(drop).some((file) => readFileSync(join(drop, file), 'utf8').includes('title: my scratch note')),
        false,
      )
      plantWorkNote(work, 'a work card added for the publisher')

      transcripts.push({
        id: 'later',
        source: 'cursor',
        text: 'read the lock log',
        changedAt: '2024-07-01T00:00:00.000Z',
        repo: 'sharlie-evolved',
      })
      ada.pass(30 * 60 * 1000)
      assert.equal(
        cardFiles(work).some((file) => readFileSync(join(work, file), 'utf8').includes('title: read the lock log')),
        true,
      )
      assert.equal(
        cardFiles(join(drive, 'Dropzone', 'ada')).some((file) =>
          readFileSync(join(drive, 'Dropzone', 'ada', file), 'utf8').includes('title: read the lock log'),
        ),
        true,
      )
      assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.md')), false)

      ada.pass(30 * 60 * 1000)
      assert.equal(
        readFileSync(join(drive, 'Dropzone', 'ada', 'extra-note.md'), 'utf8'),
        'a work card added for the publisher',
      )
      assert.equal(existsSync(join(drive, 'Dropzone', 'ada', 'extra-note.json')), true)
      assert.equal(existsSync(join(drive, 'personal')), false)
    },
    (request) => draft(request.transcript.text, request.transcript.text === 'my scratch note' ? 'personal' : 'work'),
  )
})

test('logIn and syncNow write nothing to the share folder while sharing is off', () => {
  withPerson('ada', (ada, directory, transcripts) => {
    const drive = join(directory, 'drive')
    ada.logIn()
    const window = ada.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    window.setDrivePath(drive)
    window.setAutoDrop(false)
    window.startLearning()
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    ada.install(directory)
    assert.equal(existsSync(join(drive, 'Dropzone')), false)
    const folder = join(directory, 'cards')
    assert.equal(
      cardFiles(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: retry the deploy')),
      true,
    )
    ada.syncNow()
    assert.equal(existsSync(join(drive, 'Dropzone')), false)
    ada.logOut()
    ada.logIn()
    assert.equal(existsSync(join(drive, 'Dropzone')), false)
  })
})
