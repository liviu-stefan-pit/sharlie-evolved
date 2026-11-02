import assert from 'node:assert/strict'
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  listWriters,
  newInstallId,
  readIndex,
  setKbSaveHooksForTests,
  suggestLinks,
  writeLesson,
  writerId,
  type KbLessonInput,
  type KbNode,
} from '../src/kb.ts'
import { lesson, lockFolder, withFolder } from './kb-helpers.ts'

const adaId = 'ada-11111111-1111-4111-8111-111111111111'
const graceId = 'grace-22222222-2222-4222-8222-222222222222'
const adaWriter = writerId('ada', 'k3f9')
const graceWriter = writerId('grace', 'm2p8')

function writersFor(username: string) {
  const key = username.trim().toLowerCase()
  if (key === 'grace') return graceWriter
  if (key === 'ada lovelace') return writerId('Ada Lovelace', 'k3f9')
  if (key === 'ada') return adaWriter
  return writerId(username, 'k3f9')
}

function save(folder: string, draft: KbLessonInput, index: readonly KbNode[] = []) {
  return writeLesson(folder, writersFor(draft.author.username), draft, index)
}

function node(id: string, patch: Partial<KbNode> = {}): KbNode {
  const writer = id.split('-')[0] || 'ada'
  return {
    id,
    title: 'Retry failed deploys',
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: 'A deploy failed after the lock timed out.',
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    scope: 'work',
    author: { username: writer, email: `${writer}@example.com`, team: 'platform' },
    project: 'sharlie',
    created_at: '2026-11-02T08:00:00.000Z',
    sources: ['cursor'],
    links: [],
    writer,
    synced: true,
    ...patch,
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function snapshot(folder: string) {
  const found = new Map<string, Buffer>()
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (!statSync(path).isFile()) continue
    found.set(name, readFileSync(path))
  }
  return found
}

test('readIndex skips junk and still returns work lessons', async () => {
  await withFolder(async (folder) => {
    assert.deepEqual(readIndex(join(folder, 'missing')), [])
    assert.deepEqual(listWriters(join(folder, 'missing')), [])

    const kept = {
      id: adaId,
      title: 'Retry failed deploys',
      topics: ['deploys', 'deploys', '  '],
      summary: 'Retry a failed deploy once.',
      situation: 'A deploy failed after the lock timed out.',
      whatToDo: 'Retry the deploy once, then read the log.',
      why: 'The lock clears on its own within a minute.',
      apply: 'When a deploy fails on a lock, retry once before changing config.',
      scope: 'work',
      author: { username: 'Ada', email: 'ada@example.com', team: 'platform' },
      project: 'sharlie',
      created_at: '2026-11-02T08:00:00.000Z',
      sources: ['cursor'],
      links: [{ id: graceId, writer: 'grace' }, { id: graceId, writer: 'grace' }],
    }
    writeFileSync(join(folder, `${adaId}.json`), JSON.stringify(kept))
    writeFileSync(join(folder, `${adaId}.json`.replace(/\.json$/, '.partial')), '{"title":"half')
    writeFileSync(join(folder, 'sync-delay.json.partial'), '{"title":"still syncing')
    writeFileSync(join(folder, `${graceId}.json`), '{"id":"grace-22222222-2222-4222-8222-222222222222","title":"Retry')
    writeFileSync(join(folder, 'broken.json'), '{')
    writeFileSync(join(folder, 'notes.txt'), 'foreign')
    writeFileSync(join(folder, 'readme.json'), JSON.stringify({ hello: true }))
    writeFileSync(
      join(folder, 'ada-33333333-3333-4333-8333-333333333333.json'),
      JSON.stringify({
        id: 'ada-33333333-3333-4333-8333-333333333333',
        title: 'My scratch note',
        scope: 'personal',
      }),
    )
    writeFileSync(
      join(folder, 'ada-44444444-4444-4444-8444-444444444444.json'),
      JSON.stringify({ id: 'different-44444444-4444-4444-8444-444444444444', title: 'Mismatch', scope: 'work' }),
    )
    writeFileSync(join(folder, '.hidden-lesson.json'), JSON.stringify({ id: adaId, title: 'Hidden', scope: 'work' }))
    mkdirSync(join(folder, 'ada-55555555-5555-4555-8555-555555555555.json'))
    const sealed = join(folder, 'ada-66666666-6666-4666-8666-666666666666.json')
    writeFileSync(
      sealed,
      JSON.stringify({ id: 'ada-66666666-6666-4666-8666-666666666666', title: 'Sealed lesson', scope: 'work' }),
    )
    chmodSync(sealed, 0o000)

    const nodes = readIndex(folder)
    assert.equal(nodes.length >= 1, true)
    const visible = nodes.find((item) => item.id === adaId)
    assert.ok(visible)
    assert.equal(visible.synced, true)
    assert.equal(visible.writer, 'ada')
    assert.deepEqual(visible.topics, ['deploys'])
    assert.deepEqual(visible.links, [{ id: graceId, writer: 'grace' }])
    assert.equal(
      nodes.some((item) => item.title === 'My scratch note' || item.title === 'Mismatch' || item.title === 'Hidden'),
      false,
    )
    assert.equal(nodes.some((item) => item.id === graceId), false)
    let readable = true
    try {
      accessSync(sealed, constants.R_OK)
    } catch {
      readable = false
    }
    if (!readable) assert.equal(nodes.some((item) => item.id === 'ada-66666666-6666-4666-8666-666666666666'), false)
    assert.deepEqual(listWriters(folder), ['ada'])
    chmodSync(sealed, 0o644)

    const file = join(folder, 'not-a-folder')
    writeFileSync(file, 'x')
    assert.deepEqual(readIndex(file), [])
  })
})

test('suggestLinks uses topic, project, and title words', () => {
  const deploy = node('ada-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
    title: 'Retry failed deploys',
    topics: ['deploys'],
    project: 'sharlie',
  })
  const billing = node('grace-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    title: 'Invoice the vendor',
    topics: ['billing'],
    project: 'billing',
  })
  const sameProject = node('ada-cccccccc-cccc-4ccc-8ccc-cccccccccccc', {
    title: 'Alphabet soup',
    topics: [],
    project: 'sharlie',
  })
  const sameWords = node('grace-dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
    title: 'Retry the nightly job',
    topics: [],
    project: 'none',
  })
  const quiet = node('ada-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
    title: 'The log',
    topics: [],
    project: '',
  })
  const index = [quiet, sameWords, billing, sameProject, deploy]
  const draft: KbLessonInput = lesson('linus', {
    title: 'Retry the deploy once',
    topics: ['deploys'],
    project: 'sharlie',
    author: { username: 'linus', email: 'linus@example.com', team: 'platform' },
  })

  const links = suggestLinks(draft, index)
  assert.deepEqual(links, suggestLinks(draft, [...index].reverse()))
  assert.equal(links[0]?.id, deploy.id)
  assert.ok(links.some((link) => link.id === sameProject.id && link.writer === 'ada'))
  assert.ok(links.some((link) => link.id === sameWords.id && link.writer === 'grace'))
  assert.equal(links.some((link) => link.id === billing.id || link.id === quiet.id), false)

  const self = suggestLinks({ ...draft, id: deploy.id }, index)
  assert.equal(self.some((link) => link.id === deploy.id), false)

  const tied = Array.from({ length: 10 }, (_item, index) =>
    node(`ada-${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`, {
      title: 'Unrelated title',
      topics: ['deploys'],
      project: 'other',
    }),
  )
  const capped = suggestLinks(lesson('grace', { title: 'Something else', topics: ['deploys'], project: '' }), tied)
  assert.equal(capped.length, 8)
  assert.deepEqual(
    capped.map((link) => link.id),
    tied
      .map((item) => item.id)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, 8),
  )

  const strong = node('zzz-ffffffff-ffff-4fff-8fff-ffffffffffff', { topics: ['deploys', 'locks'], title: 'No shared words here' })
  const weak = node('aaa-ffffffff-ffff-4fff-8fff-ffffffffffff', { topics: [], title: 'Retry later', project: 'elsewhere' })
  const ordered = suggestLinks(lesson('ada', { title: 'Retry the lock', topics: ['deploys', 'locks'], project: 'nope' }), [
    weak,
    strong,
  ])
  assert.deepEqual(
    ordered.map((link) => link.id),
    [strong.id, weak.id],
  )
})

test('personal and scope-less lessons are never written', async () => {
  await withFolder(async (folder) => {
    const personal = await save(folder, lesson('ada', { scope: 'personal', title: 'My scratch note' }), [])
    const bare = lesson('ada', { title: 'No scope note' })
    delete bare.scope
    const missing = await save(folder, bare, [])
    const wrong = await save(folder, lesson('ada', { scope: 'Work', title: 'Wrong scope' }), [])
    assert.equal(personal.ok, false)
    assert.equal(missing.ok, false)
    assert.equal(wrong.ok, false)
    if (!personal.ok) assert.match(personal.reason, /personal/)
    if (!missing.ok) assert.match(missing.reason, /personal/)
    if (!wrong.ok) assert.match(wrong.reason, /work/)
    assert.deepEqual(readdirSync(folder), [])
    assert.deepEqual(readIndex(folder), [])
  })
})

test('a missing or read-only folder returns a reason', async () => {
  await withFolder(async (folder) => {
    const missing = join(folder, 'missing')
    const gone = await save(missing, lesson('ada'), [])
    assert.equal(gone.ok, false)
    if (!gone.ok) assert.match(gone.reason, /does not exist/)
    assert.equal(statSync(folder).isDirectory(), true)
    assert.equal(
      readdirSync(folder).some((name) => name === 'missing'),
      false,
    )

    const blocked = join(folder, 'blocked')
    mkdirSync(blocked)
    const unlock = lockFolder(blocked)
    try {
      let thrown = false
      try {
        const refused = await save(blocked, lesson('ada'), [])
        assert.equal(refused.ok, false)
        if (!refused.ok) assert.match(refused.reason, /not writable/)
      } catch {
        thrown = true
      }
      assert.equal(thrown, false)
      assert.deepEqual(readdirSync(blocked), [])
    } finally {
      unlock()
    }

    const file = join(folder, 'not-a-folder')
    writeFileSync(file, 'x')
    const notFolder = await save(file, lesson('ada'), [])
    assert.equal(notFolder.ok, false)
    if (!notFolder.ok) assert.match(notFolder.reason, /not a folder|not writable/)
    assert.equal(readFileSync(file, 'utf8'), 'x')
  })
})

test('a lesson round-trips as json and markdown with links filled', async () => {
  await withFolder(async (folder) => {
    const first = await save(
      folder,
      lesson('Ada Lovelace', {
        title: 'Retry: failed deploys',
        author: { username: 'Ada Lovelace', email: 'ada@example.com', team: 'platform' },
      }),
      [],
    )
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.match(first.lesson.id, /^ada-lovelace-k3f9-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.equal(first.lesson.writer, 'ada-lovelace-k3f9')
    assert.equal(first.lesson.synced, true)
    assert.equal(first.lesson.author.username, 'Ada Lovelace')
    assert.deepEqual(first.lesson.links, [])

    const second = await save(
      folder,
      lesson('grace', {
        title: 'Retry the deploy once',
        topics: ['deploys'],
        project: 'billing',
      }),
      readIndex(folder),
    )
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.ok(second.lesson.links.some((link) => link.id === first.lesson.id && link.writer === 'ada-lovelace-k3f9'))

    const stored = JSON.parse(readFileSync(join(folder, `${second.lesson.id}.json`), 'utf8')) as KbNode
    assert.equal(stored.id, second.lesson.id)
    assert.equal(stored.title, 'Retry the deploy once')
    assert.equal(stored.scope, 'work')
    assert.equal(stored.project, 'billing')
    assert.deepEqual(stored.sources, ['cursor'])
    assert.equal(stored.created_at, '2026-11-02T08:00:00.000Z')
    assert.deepEqual(stored.links, second.lesson.links)
    const markdown = readFileSync(join(folder, `${second.lesson.id}.md`), 'utf8')
    assert.match(markdown, new RegExp(`id: ${second.lesson.id}`))
    assert.match(markdown, /scope: work/)
    assert.match(markdown, new RegExp(first.lesson.id))
    assert.match(markdown, /## What to do\n\nRetry the deploy once, then read the log\./)
    const firstMarkdown = readFileSync(join(folder, `${first.lesson.id}.md`), 'utf8')
    assert.match(firstMarkdown, /title: "Retry: failed deploys"/)
    const seen = readIndex(folder)
    assert.equal(seen.length, 2)
    assert.equal(seen.every((item) => item.synced && item.writer !== ''), true)
    assert.deepEqual(listWriters(folder), ['ada-lovelace-k3f9', 'grace-m2p8'])
    const firstOnDisk = JSON.parse(readFileSync(join(folder, `${first.lesson.id}.json`), 'utf8')) as { links: unknown[] }
    assert.deepEqual(firstOnDisk.links, [])
  })
})

test('a writer rewrites only its own lesson', async () => {
  await withFolder(async (folder) => {
    const ownId = `${adaWriter}-11111111-1111-4111-8111-111111111111`
    const created = await save(folder, lesson('ada', { id: ownId, summary: 'First summary.' }), [])
    assert.equal(created.ok, true)
    if (!created.ok) return
    const before = readFileSync(join(folder, `${ownId}.json`))
    const names = readdirSync(folder).sort()

    const stolen = await save(folder, lesson('grace', { id: ownId, title: 'Taken over' }), readIndex(folder))
    const malformed = await save(folder, lesson('ada', { id: 'card_1', title: 'Bad id' }), [])
    assert.equal(stolen.ok, false)
    assert.equal(malformed.ok, false)
    if (!stolen.ok) assert.match(stolen.reason, /own lesson id/)
    assert.deepEqual(readdirSync(folder).sort(), names)
    assert.deepEqual(readFileSync(join(folder, `${ownId}.json`)), before)

    const rewritten = await save(
      folder,
      lesson('ada', { id: ownId, summary: 'Updated summary.' }),
      readIndex(folder),
    )
    assert.equal(rewritten.ok, true)
    if (!rewritten.ok) return
    assert.equal(rewritten.lesson.id, ownId)
    assert.equal(rewritten.lesson.summary, 'Updated summary.')
    assert.equal(rewritten.lesson.created_at, '2026-11-02T08:00:00.000Z')
    const after = JSON.parse(readFileSync(join(folder, `${ownId}.json`), 'utf8')) as { summary: string; id: string }
    assert.equal(after.id, ownId)
    assert.equal(after.summary, 'Updated summary.')
    assert.match(readFileSync(join(folder, `${ownId}.md`), 'utf8'), /Updated summary\./)
    assert.equal(readdirSync(folder).filter((name) => name.endsWith('.json') && !name.startsWith('.')).length, 1)
  })
})

test('newInstallId is four letters or digits and writerId keeps the install id', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 20; i += 1) {
    const id = newInstallId()
    assert.match(id, /^[a-z0-9]{4}$/)
    seen.add(id)
  }
  assert.equal(seen.size > 1, true)
  assert.equal(writerId('Ada Lovelace', 'K3F9'), 'ada-lovelace-k3f9')
  assert.equal(writerId('Ada Lovelace', 'no'), '')
})

test('two people with the same name do not overwrite each other', async () => {
  await withFolder(async (folder) => {
    const firstWriter = writerId('Ada Lovelace', 'k3f9')
    const secondWriter = writerId('Ada Lovelace', 'm2p8')
    assert.equal(firstWriter, 'ada-lovelace-k3f9')
    assert.equal(secondWriter, 'ada-lovelace-m2p8')
    const ada = lesson('Ada Lovelace', {
      author: { username: 'Ada Lovelace', email: 'ada@example.com', team: 'platform' },
      summary: 'Ada summary.',
    })
    const other = lesson('Ada Lovelace', {
      author: { username: 'Ada Lovelace', email: 'other@example.com', team: 'platform' },
      summary: 'Other summary.',
    })
    const first = await writeLesson(folder, firstWriter, ada, [])
    const second = await writeLesson(folder, secondWriter, other, readIndex(folder))
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    if (!first.ok || !second.ok) return
    assert.notEqual(first.lesson.id, second.lesson.id)
    assert.equal(first.lesson.writer, firstWriter)
    assert.equal(second.lesson.writer, secondWriter)
    const firstBody = JSON.parse(readFileSync(join(folder, `${first.lesson.id}.json`), 'utf8')) as { summary: string }
    const secondBody = JSON.parse(readFileSync(join(folder, `${second.lesson.id}.json`), 'utf8')) as { summary: string }
    assert.equal(firstBody.summary, 'Ada summary.')
    assert.equal(secondBody.summary, 'Other summary.')

    const again = await writeLesson(
      folder,
      firstWriter,
      { ...ada, id: first.lesson.id, summary: 'Updated summary.' },
      readIndex(folder),
    )
    assert.equal(again.ok, true)
    if (!again.ok) return
    assert.equal(again.lesson.id, first.lesson.id)
    assert.equal(
      (JSON.parse(readFileSync(join(folder, `${first.lesson.id}.json`), 'utf8')) as { summary: string }).summary,
      'Updated summary.',
    )
    assert.equal(
      (JSON.parse(readFileSync(join(folder, `${second.lesson.id}.json`), 'utf8')) as { summary: string }).summary,
      'Other summary.',
    )

    const stolen = await writeLesson(
      folder,
      secondWriter,
      { ...other, id: first.lesson.id, summary: 'Taken over' },
      readIndex(folder),
    )
    assert.equal(stolen.ok, false)
    if (!stolen.ok) assert.match(stolen.reason, /own lesson id/)
    const collided = await writeLesson(
      folder,
      firstWriter,
      { ...other, id: first.lesson.id, summary: 'Taken over' },
      readIndex(folder),
    )
    assert.equal(collided.ok, false)
    if (!collided.ok) assert.match(collided.reason, /different email/)
    assert.equal(
      (JSON.parse(readFileSync(join(folder, `${first.lesson.id}.json`), 'utf8')) as { summary: string }).summary,
      'Updated summary.',
    )
  })
})

test('the note is saved before the json, so a failed json rename leaves no json without its note', async () => {
  await withFolder(async (folder) => {
    setKbSaveHooksForTests({
      rename: async (from, to) => {
        if (to.endsWith('.json')) {
          const error = new Error('killed') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        await rename(from, to)
      },
      wait: async () => undefined,
    })
    let killedNew: Awaited<ReturnType<typeof save>>
    try {
      killedNew = await save(folder, lesson('ada', { title: 'Killed before json' }))
    } finally {
      setKbSaveHooksForTests(null)
    }
    assert.equal(killedNew.ok, false)
    const notes = readdirSync(folder).filter((name) => name.endsWith('.md') && !name.startsWith('.'))
    assert.equal(notes.length, 1)
    const noteId = notes[0]?.slice(0, -'.md'.length)
    assert.equal(existsSync(join(folder, `${noteId}.json`)), false)
    assert.equal(
      readdirSync(folder).some((name) => name.endsWith('.tmp')),
      false,
    )

    const renamed: string[] = []
    setKbSaveHooksForTests({
      rename: async (from, to) => {
        renamed.push(to)
        await rename(from, to)
      },
    })
    let created: Awaited<ReturnType<typeof save>>
    try {
      created = await save(folder, lesson('ada', { summary: 'Noted first.' }))
    } finally {
      setKbSaveHooksForTests(null)
    }
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(renamed.length, 2)
    assert.equal(renamed[0]?.endsWith('.md'), true)
    assert.equal(renamed[1]?.endsWith('.json'), true)

    setKbSaveHooksForTests({
      rename: async (from, to) => {
        if (to.endsWith('.json')) {
          const error = new Error('killed') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        await rename(from, to)
      },
      wait: async () => undefined,
    })
    let killed: Awaited<ReturnType<typeof save>>
    try {
      killed = await save(folder, lesson('ada', { id: created.lesson.id, summary: 'Half written.' }))
    } finally {
      setKbSaveHooksForTests(null)
    }
    assert.equal(killed.ok, false)
    assert.equal(existsSync(join(folder, `${created.lesson.id}.md`)), true)
    const stored = JSON.parse(readFileSync(join(folder, `${created.lesson.id}.json`), 'utf8')) as { summary: string }
    assert.equal(stored.summary, 'Noted first.')
    assert.equal(
      readdirSync(folder).some((name) => name.endsWith('.tmp')),
      false,
    )
  })
})

test('a save deletes only this writer\'s temp files older than 10 minutes', async () => {
  await withFolder(async (folder) => {
    const old = new Date(Date.now() - 11 * 60 * 1000)
    const ownOld = join(folder, `.${adaWriter}-stale.json.111.tmp`)
    const ownFresh = join(folder, `.${adaWriter}-fresh.json.222.tmp`)
    const otherOld = join(folder, `.${graceWriter}-stale.json.333.tmp`)
    const ownNote = join(folder, `.${adaWriter}-notes.txt`)
    for (const path of [ownOld, ownFresh, otherOld, ownNote]) writeFileSync(path, 'temp')
    utimesSync(ownOld, old, old)
    utimesSync(otherOld, old, old)
    const result = await save(folder, lesson('ada', { title: 'Clear stale temps' }))
    assert.equal(result.ok, true)
    assert.equal(existsSync(ownOld), false)
    assert.equal(existsSync(ownFresh), true)
    assert.equal(existsSync(otherOld), true)
    assert.equal(existsSync(ownNote), true)
    assert.equal(readFileSync(otherOld, 'utf8'), 'temp')
  })
})

test('a rename that keeps failing removes the temp file and leaves the lesson as it was', async () => {
  await withFolder(async (folder) => {
    const created = await save(folder, lesson('ada', { summary: 'Keep me.' }))
    assert.equal(created.ok, true)
    if (!created.ok) return
    const before = readFileSync(join(folder, `${created.lesson.id}.json`))
    for (const code of ['EEXIST', 'EPERM']) {
      const waits: number[] = []
      let calls = 0
      setKbSaveHooksForTests({
        rename: async () => {
          calls += 1
          const error = new Error('busy') as NodeJS.ErrnoException
          error.code = code
          throw error
        },
        wait: async (ms) => {
          waits.push(ms)
        },
      })
      try {
        const result = await save(folder, lesson('ada', { id: created.lesson.id, summary: 'Replaced.' }))
        assert.equal(result.ok, false)
        if (!result.ok) assert.equal(result.reason, 'could not finish saving the lesson')
      } finally {
        setKbSaveHooksForTests(null)
      }
      assert.equal(calls, 5)
      assert.deepEqual(waits, [200, 200, 200, 200])
      assert.deepEqual(readFileSync(join(folder, `${created.lesson.id}.json`)), before)
      assert.equal(
        readdirSync(folder).some((name) => name.endsWith('.tmp')),
        false,
      )
    }
  })
})

test('two writers share one folder without losing a file or leaving an orphan', async () => {
  await withFolder(async (folder) => {
    const partial = 'ada-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'
    writeFileSync(join(folder, partial), '{"id":"ada-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","title":"Retry')
    writeFileSync(join(folder, 'notes.txt'), 'leave me')
    writeFileSync(join(folder, 'broken.json'), '{')
    writeFileSync(join(folder, '.ada-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json.1.tmp'), '{"title":"temp"')

    const first = await save(
      folder,
      lesson('ada', { title: 'Retry failed deploys', topics: ['deploys'], project: 'sharlie' }),
      readIndex(folder),
    )
    assert.equal(first.ok, true)
    if (!first.ok) return
    assert.deepEqual(first.lesson.links, [])

    const second = await save(
      folder,
      lesson('grace', { title: 'Retry the deploy once', topics: ['deploys'], project: 'billing' }),
      readIndex(folder),
    )
    assert.equal(second.ok, true)
    if (!second.ok) return
    assert.ok(second.lesson.links.some((link) => link.id === first.lesson.id && link.writer === adaWriter))
    const firstBytes = readFileSync(join(folder, `${first.lesson.id}.json`))

    const before = snapshot(folder)
    const specs = [
      lesson('ada', { title: 'Read the deploy lock', topics: ['deploys', 'locks'], project: 'sharlie' }),
      lesson('grace', { title: 'Watch a stale lock', topics: ['locks'], project: 'sharlie' }),
      lesson('ada', { title: 'Clear the deploy lock', topics: ['locks'], project: 'other' }),
      lesson('grace', { title: 'Retry failed deploys', topics: ['deploys'], project: 'sharlie' }),
      lesson('ada', { title: 'Note the framework version', topics: ['versions'], project: 'docs' }),
      lesson('grace', { title: 'Pin the framework version', topics: ['versions'], project: 'docs' }),
    ]
    const writes = await Promise.all(
      specs.map(async (draft, index) => {
        const seen = readIndex(folder)
        await delay((index % 3) * 10)
        if (index === 1) writeFileSync(join(folder, 'mid-sync.json.partial'), '{"title":"still syncing')
        const result = await save(folder, draft, seen)
        return { seen, result, draft }
      }),
    )

    for (const { seen, result } of writes) {
      assert.equal(result.ok, true)
      if (!result.ok) continue
      const expected = suggestLinks(
        {
          id: result.lesson.id,
          title: result.lesson.title,
          topics: result.lesson.topics,
          project: result.lesson.project,
          author: result.lesson.author,
        },
        seen,
      )
      assert.deepEqual(result.lesson.links, expected)
      if (expected.length > 0) assert.ok(result.lesson.links.length >= 1)
    }

    const duplicate = writes.find((item) => item.draft.title === 'Retry failed deploys')
    assert.ok(duplicate)
    if (duplicate && duplicate.result.ok) assert.ok(duplicate.result.lesson.links.length >= 1)

    for (const [name, bytes] of before) {
      assert.equal(readdirSync(folder).includes(name), true, name)
      assert.deepEqual(readFileSync(join(folder, name)), bytes)
    }
    assert.deepEqual(readFileSync(join(folder, `${first.lesson.id}.json`)), firstBytes)

    const nodes = readIndex(folder)
    const ids = nodes.map((item) => item.id)
    assert.equal(new Set(ids).size, ids.length)
    const written = [first, second, ...writes.map((item) => item.result)]
    for (const result of written) {
      assert.equal(result.ok, true)
      if (!result.ok) continue
      assert.ok(ids.includes(result.lesson.id))
      const body = readFileSync(join(folder, `${result.lesson.id}.json`), 'utf8')
      const parsed = JSON.parse(body) as { id: string; scope: string; links: { id: string }[] }
      assert.equal(parsed.id, result.lesson.id)
      assert.equal(parsed.scope, 'work')
      assert.deepEqual(parsed.links, result.lesson.links)
      assert.equal(statSync(join(folder, `${result.lesson.id}.md`)).isFile(), true)
    }
    assert.ok(nodes.filter((item) => item.title === 'Retry failed deploys').length >= 2)
    assert.equal(nodes.some((item) => item.id === partial.slice(0, -'.json'.length)), false)
    assert.equal(readFileSync(join(folder, partial), 'utf8').includes('"title":"Retry'), true)
    assert.equal(readFileSync(join(folder, 'notes.txt'), 'utf8'), 'leave me')
    assert.equal(readFileSync(join(folder, 'broken.json'), 'utf8'), '{')
    assert.equal(readdirSync(folder).includes('index.json'), false)
    assert.deepEqual(listWriters(folder), [adaWriter, graceWriter])
    assert.equal(nodes.every((item) => item.synced === true), true)
  })
})
