import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { machineWith } from './machine.ts'

const missingSecrets = new Set<string>()
const secretErrors = new Map<string, Error>()

mock.module('../src/vault.ts', {
  namedExports: {
    writeSecret() {},
    deleteSecret() {},
    deleteVault() {},
    readSecret(vaultId: string, keyId: string) {
      if (missingSecrets.has(vaultId)) {
        throw new Error(`No secret stored for key ${keyId}`)
      }
      const broken = secretErrors.get(vaultId)
      if (broken) throw broken
      return 'sk-ant-api03-aaaa'
    },
  },
})

function hold<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function draft(title: string) {
  return {
    scope: 'work' as const,
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

function chat(id: string, text = id, changedAt = '2024-01-01T00:00:00.000Z') {
  return { id, source: 'cursor' as const, text, changedAt, repo: 'sharlie-evolved' }
}

test('an async complete invokes onLearning with an increasing done before runLearner resolves, and the card is already on disk at the first callback', async () => {
  const { discardVault, learningProgress, onLearning, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-learn-'))
  try {
    const first = hold<ReturnType<typeof draft>>()
    const second = hold<ReturnType<typeof draft>>()
    const lessons = [first, second]
    let next = 0
    const app = openApp(
      directory,
      () => {
        const pending = lessons[next]
        next += 1
        return pending.promise
      },
      machineWith(directory, ['cursor', 'claude']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })

    let announced = 0
    const stop = onLearning((progress) => {
      if (progress.done < 1) return
      const cards = readdirSync(join(directory, 'cards'))
      assert.equal(
        cards.some((name) => name.endsWith('.md')),
        true,
      )
      announced = progress.done
    })

    const running = app.runLearner(
      [
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
      ],
      { foreground: true },
    )
    assert.equal(running instanceof Promise, true)

    first.resolve(draft('newer chat'))
    const cardReadyAt = Date.now()
    let cardReady = false
    while (!cardReady && Date.now() - cardReadyAt < 1000) {
      await new Promise((resolve) => setImmediate(resolve))
      try {
        cardReady = readdirSync(join(directory, 'cards')).some((name) => name.endsWith('.md'))
      } catch {
        cardReady = false
      }
    }
    assert.equal(cardReady, true)
    assert.equal(learningProgress()?.done, 1)
    second.resolve(draft('older chat'))

    const learned = await running
    assert.equal(learned.ran, true)
    assert.ok(announced >= 1)
    assert.deepEqual(learningProgress(), { active: false, done: 2, total: 2 })
    stop()
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an async batch of 10 finishes before chat 11 is sent to complete', async () => {
  const { discardVault, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-batch-'))
  try {
    const holds = Array.from({ length: 11 }, () => hold<ReturnType<typeof draft>>())
    let calls = 0
    const app = openApp(
      directory,
      () => {
        const pending = holds[calls]
        calls += 1
        return pending.promise
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const history = Array.from({ length: 11 }, (_, index) =>
      chat(`chat-${index}`, `chat ${index}`, new Date(Date.UTC(2024, 0, index + 1)).toISOString()),
    )
    const running = app.runLearner(history, { foreground: true })
    assert.equal(calls, 10)
    for (const item of holds.slice(0, 10)) item.resolve(draft('Retry failed deploys'))
    const started = Date.now()
    while (calls < 11 && Date.now() - started < 1000) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    assert.equal(calls, 11)
    holds[10].resolve(draft('Retry failed deploys'))
    const learned = await running
    assert.equal(learned.ran, true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a rejected lesson sets error, increments done, stays retryable, and the next lesson still writes', async () => {
  const { discardVault, learningProgress, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-reject-'))
  try {
    const first = hold<ReturnType<typeof draft>>()
    const second = hold<ReturnType<typeof draft>>()
    let next = 0
    const app = openApp(
      directory,
      () => {
        const pending = next === 0 ? first : second
        next += 1
        return pending.promise
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const failed = chat('failed-chat', 'failed chat', '2024-02-01T00:00:00.000Z')
    const ok = chat('ok-chat', 'ok chat', '2024-01-01T00:00:00.000Z')
    const running = app.runLearner([failed, ok], { foreground: true })
    first.reject(new Error('model timed out'))
    second.resolve(draft('Retry failed deploys'))
    const learned = await running
    assert.equal(learned.ran, true)
    const progress = learningProgress()
    assert.equal(progress?.active, false)
    assert.equal(progress?.done, 2)
    assert.equal(progress?.total, 2)
    assert.equal(progress?.error, 'model timed out')
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      importedTranscripts: Record<string, string>
    }
    assert.equal(Object.hasOwn(settings.importedTranscripts, 'failed-chat'), false)
    assert.equal(Object.hasOwn(settings.importedTranscripts, 'ok-chat'), true)
    const cards = readdirSync(join(directory, 'cards')).map((name) => readFileSync(join(directory, 'cards', name), 'utf8'))
    assert.equal(
      cards.some((card) => card.includes('title: Retry failed deploys')),
      true,
    )
    const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
      lines: string[]
    }
    assert.equal(journal.lines.includes('Found 2 transcripts'), true)
    assert.equal(journal.lines.includes('cursor · failed-chat · learning'), true)
    assert.equal(
      journal.lines.some((line) => line.includes('failed · model timed out')),
      true,
    )
    assert.equal(journal.lines.includes('cursor · ok-chat · card "Retry failed deploys"'), true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('at done === 1 the graph has the card and a blank draft is skipped as lesson incomplete', async () => {
  const { discardVault, learningProgress, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-graph-'))
  try {
    const first = hold<ReturnType<typeof draft>>()
    const second = hold<ReturnType<typeof draft>>()
    let next = 0
    const app = openApp(
      directory,
      () => {
        const pending = next === 0 ? first : second
        next += 1
        return pending.promise
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const running = app.runLearner(
      [chat('good', 'good chat', '2024-02-01T00:00:00.000Z'), chat('blank', 'blank chat', '2024-01-01T00:00:00.000Z')],
      { foreground: true },
    )
    first.resolve(draft('Retry failed deploys'))
    const seenAt = Date.now()
    let ready = false
    while (!ready && Date.now() - seenAt < 1000) {
      await new Promise((resolve) => setImmediate(resolve))
      ready =
        learningProgress()?.done === 1 &&
        app.graph().nodes.some((node) => node.kind === 'card' && node.label === 'Retry failed deploys')
    }
    assert.equal(ready, true)
    second.resolve({ ...draft(''), title: '', summary: '', situation: '', whatToDo: '', why: '', apply: '', topics: [] })
    await running
    const cards = readdirSync(join(directory, 'cards')).filter((name) => name.endsWith('.json') && name.startsWith('card_'))
    assert.equal(cards.length, 1)
    const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
      lines: string[]
    }
    assert.equal(journal.lines.includes('cursor · blank · skipped · lesson incomplete'), true)
    assert.equal(journal.lines.includes('cursor · good · card "Retry failed deploys"'), true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('setKnowledgePath to an empty folder copies the profile, clears imports, and startLearning reads chats again', async () => {
  const { discardVault, openUserSession } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-empty-'))
  const next = mkdtempSync(join(tmpdir(), 'sharlie-dest-'))
  const transcripts = [chat('deploy', 'retry the deploy')]
  let seen = 0
  const session = openUserSession(
    'ada',
    () => {
      seen += 1
      return draft('Retry failed deploys')
    },
    machineWith(directory, ['cursor']),
    () => transcripts,
  )
  try {
    session.logIn()
    const window = session.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    window.startLearning()
    assert.equal(seen, 1)
    window.setKnowledgePath(next)
    const dest = session.openWindow(directory)
    assert.deepEqual(dest.profile(), { username: 'ada', email: 'ada@example.com', team: 'platform' })
    const settings = JSON.parse(readFileSync(join(next, 'settings.json'), 'utf8')) as {
      importedTranscripts: Record<string, string>
      learningTokens: number
      learningTokensUnreported: number
      learningStarted: boolean
      initialIngestComplete: boolean
    }
    assert.deepEqual(settings.importedTranscripts, {})
    assert.equal(settings.learningTokens, 0)
    assert.equal(settings.learningTokensUnreported, 0)
    assert.equal(settings.learningStarted, false)
    assert.equal(settings.initialIngestComplete, false)
    assert.equal(readdirSync(next).includes('cards'), false)
    dest.startLearning()
    assert.equal(seen, 2)
  } finally {
    discardVault(directory)
    discardVault(next)
    rmSync(directory, { recursive: true, force: true })
    rmSync(next, { recursive: true, force: true })
  }
})

test('an unfinished journal survives openApp and the timer learn() does not run', async () => {
  const { discardVault, openApp, openUserSession } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-journal-'))
  const first = hold<ReturnType<typeof draft>>()
  const transcripts = [chat('open', 'open chat')]
  let calls = 0
  try {
    const started = openApp(
      directory,
      () => {
        calls += 1
        return first.promise
      },
      machineWith(directory, ['cursor']),
    )
    started.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    started.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    started.beginLearning(transcripts)
    assert.equal(calls, 1)
    const recorded = ['Found 1 transcript', 'cursor · open · learning']
    assert.deepEqual(started.ingestLog().lines, recorded)
    const reopened = openApp(directory, () => draft('should not run'), machineWith(directory, ['cursor']))
    assert.equal(reopened.initialIngestComplete(), false)
    assert.deepEqual(reopened.ingestLog().lines, recorded)
    assert.deepEqual(reopened.ingestView(0, transcripts)?.lines, recorded)
    const session = openUserSession(
      'ada',
      () => {
        calls += 1
        return draft('timer should not run')
      },
      machineWith(directory, ['cursor']),
      () => transcripts,
    )
    session.logIn()
    session.openWindow(directory)
    session.pass(60 * 60 * 1000)
    assert.equal(calls, 1)
    first.resolve(draft('Retry failed deploys'))
    await Promise.resolve()
    await Promise.resolve()
  } finally {
    first.resolve(draft('Retry failed deploys'))
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ingest log keeps the last 300 lines and does not turn an old items table into a queue', async () => {
  const { discardVault, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-cap-'))
  try {
    writeFileSync(
      join(directory, 'ingest-log.json'),
      JSON.stringify({
        items: [{ key: 'old', source: 'cursor', label: 'old.json', status: 'queued' }],
        tokens: 3,
        unreported: 1,
      }),
    )
    const app = openApp(
      directory,
      () => draft('Retry failed deploys'),
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const legacy = app.ingestLog()
    assert.deepEqual(legacy.lines, [])
    assert.equal(legacy.tokens, 3)
    assert.equal(legacy.unreported, 1)
    assert.equal(app.ingestView(0, [chat('old.json')]), null)

    writeFileSync(
      join(directory, 'ingest-log.json'),
      JSON.stringify({
        lines: Array.from({ length: 300 }, (_, index) => `old-${index}`),
        tokens: 0,
        unreported: 0,
      }),
    )
    const learned = app.runLearner([chat('cap.json')], { foreground: true })
    assert.equal(learned instanceof Promise, false)
    const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
      lines: string[]
    }
    assert.equal(journal.lines.length, 300)
    assert.equal(journal.lines.includes('old-0'), false)
    assert.equal(journal.lines.includes('Found 1 transcript'), true)
    assert.equal(journal.lines[journal.lines.length - 1], 'cursor · cap.json · card "Retry failed deploys"')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('desktop learning stores reported tokens, counts unreported Cursor calls, and lookup does not add', async () => {
  const { discardVault, openUserSession } = await import('../src/app.ts')
  const { desktopLesson } = await import('../src/host.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-tokens-'))
  const next = mkdtempSync(join(tmpdir(), 'sharlie-tokens-dest-'))
  const lesson = JSON.stringify(draft('Retry failed deploys'))
  let learningCalls = 0
  const transcripts = [chat('one', 'one chat', '2024-02-01T00:00:00.000Z'), chat('two', 'two chat', '2024-01-01T00:00:00.000Z')]
  const fetchImpl = async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { messages?: { content: string }[] }
    const prompt = body.messages?.[0]?.content ?? ''
    if (prompt.includes('Question:')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"answer":"Retry once."}' }], usage: { total_tokens: 999 } }))
    }
    learningCalls += 1
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: lesson }],
        usage: { total_tokens: learningCalls === 1 ? 100 : 50 },
      }),
    )
  }
  let session: ReturnType<typeof openUserSession>
  session = openUserSession(
    'ada',
    desktopLesson(() => session.knowledgeDirectory(directory), fetchImpl, {}, machineWith(directory, ['cursor'])),
    machineWith(directory, ['cursor']),
    () => transcripts,
  )
  try {
    session.logIn()
    const window = session.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await window.runLearner(transcripts, { foreground: true })
    assert.equal(window.learningTokens(), 150)
    assert.equal(window.learningTokensUnreported(), 0)

    window.saveKey({
      provider: 'cursor',
      secret: 'cursor-key',
      account: { models: [{ id: 'composer', displayName: 'Composer' }] },
    })
    window.activateProvider('cursor')
    window.selectModel('composer')
    const extra = [chat('three', 'three chat', '2024-03-01T00:00:00.000Z')]
    const { openApp } = await import('../src/app.ts')
    const cursorLesson = desktopLesson(
      () => session.knowledgeDirectory(directory),
      fetchImpl,
      { cursorPrompt: async () => lesson },
      machineWith(directory, ['cursor']),
    )
    const cursorApp = openApp(directory, cursorLesson, machineWith(directory, ['cursor']))
    await cursorApp.runLearner(extra, { foreground: true })
    assert.equal(cursorApp.learningTokens(), 150)
    assert.equal(cursorApp.learningTokensUnreported(), 1)

    const { callModel } = await import('../src/exchange.ts')
    const lookupApp = openApp(
      directory,
      undefined,
      machineWith(directory, ['cursor']),
      async (turn) => {
        const replied = await callModel(
          {
            provider: 'anthropic',
            secret: 'sk-ant-api03-aaaa',
            model: 'claude-haiku-5-5',
            prompt: `Question: ${JSON.stringify(turn)}`,
          },
          fetchImpl,
        )
        return JSON.parse(replied.text.match(/\{[\s\S]*\}/)?.[0] ?? replied.text) as { pick: string[] } | { answer: string }
      },
    )
    await lookupApp.lookup('how do I retry')
    assert.equal(lookupApp.learningTokens(), 150)
    assert.equal(cursorApp.learningTokens(), 150)

    window.setKnowledgePath(next)
    const dest = session.openWindow(directory)
    assert.equal(dest.learningTokens(), 0)
    assert.equal(dest.learningTokensUnreported(), 0)
  } finally {
    discardVault(directory)
    discardVault(next)
    rmSync(directory, { recursive: true, force: true })
    rmSync(next, { recursive: true, force: true })
  }
})

test('a missing key secret records one failure, stops the run, and leaves chats unmarked', async () => {
  const { discardVault, learningProgress, onLearning, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-missing-secret-'))
  let stop = () => {}
  let vaultId = ''
  try {
    let completeCalls = 0
    const app = openApp(
      directory,
      () => {
        completeCalls += 1
        return draft('Retry failed deploys')
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      vaultId: string
      keys: { id: string; active: boolean }[]
    }
    vaultId = settings.vaultId
    missingSecrets.add(vaultId)
    const keyId = settings.keys.find((key) => key.active)?.id
    assert.equal(typeof keyId, 'string')
    const missing = `No secret stored for key ${keyId}`
    const history = Array.from({ length: 12 }, (_, index) =>
      chat(`missing-${index}`, `missing ${index}`, new Date(Date.UTC(2024, 0, index + 1)).toISOString()),
    )
    const snapshots: { error?: string; lines: string[] }[] = []
    stop = onLearning((progress) => {
      try {
        const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
          lines: string[]
        }
        if (!journal.lines.includes('Found 12 transcripts')) return
        if (!journal.lines.some((line) => line.includes('failed · ') || line.includes('missing-0'))) return
        snapshots.push({ error: progress.error, lines: journal.lines })
      } catch {
        // Another test may emit after this vault is removed.
      }
    })
    const learned = await app.runLearner(history, { foreground: true })
    assert.equal(learned.ran, true)
    assert.equal(completeCalls, 0)
    assert.equal(app.learningTokens(), 0)
    assert.equal(app.initialIngestComplete(), false)
    const progress = learningProgress()
    assert.equal(progress?.active, false)
    assert.equal(progress?.error, missing)
    const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
      lines: string[]
    }
    assert.equal(journal.lines.includes('Found 12 transcripts'), true)
    assert.equal(journal.lines.includes(`failed · ${missing}`), true)
    assert.equal(
      journal.lines.filter((line) => line.includes(' · learning')).length,
      0,
    )
    assert.equal(
      journal.lines.filter((line) => line.includes('failed')).length,
      1,
    )
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      importedTranscripts: Record<string, string>
      learningTokens: number
    }
    assert.deepEqual(stored.importedTranscripts, {})
    assert.equal(stored.learningTokens, 0)
    assert.equal(app.ingestView(0, history)?.lines.includes('Found 12 transcripts'), true)
    assert.equal(
      snapshots.some((snapshot) => snapshot.error === missing && snapshot.lines.includes(`failed · ${missing}`)),
      true,
    )
  } finally {
    stop()
    if (vaultId) missingSecrets.delete(vaultId)
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('a non-secret activeKey failure flushes Found and one failure without walking transcripts', async () => {
  const { discardVault, learningProgress, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-key-failure-'))
  let vaultId = ''
  try {
    let completeCalls = 0
    const app = openApp(
      directory,
      () => {
        completeCalls += 1
        return draft('Retry failed deploys')
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { vaultId: string }
    vaultId = settings.vaultId
    secretErrors.set(vaultId, new Error('keyring is locked'))
    const history = Array.from({ length: 3 }, (_, index) =>
      chat(`locked-${index}`, `locked ${index}`, new Date(Date.UTC(2024, 0, index + 1)).toISOString()),
    )
    assert.throws(() => app.runLearner(history, { foreground: true }), /keyring is locked/)
    assert.equal(completeCalls, 0)
    assert.equal(app.initialIngestComplete(), false)
    let lines: string[] = []
    try {
      lines = (
        JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as { lines: string[] }
      ).lines
    } catch {
      lines = []
    }
    assert.equal(lines.includes('Found 3 transcripts'), true)
    assert.equal(lines.includes('failed · keyring is locked'), true)
    assert.equal(lines.filter((line) => line.includes('failed')).length, 1)
    assert.equal(lines.filter((line) => line.includes(' · learning')).length, 0)
    const progress = learningProgress()
    assert.equal(progress?.active, false)
    assert.equal(progress?.error, 'keyring is locked')
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      importedTranscripts: Record<string, string>
    }
    assert.deepEqual(stored.importedTranscripts, {})
  } finally {
    if (vaultId) secretErrors.delete(vaultId)
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('staggered foreground batches flush the ingest log and learning snapshot once per batch', async () => {
  const { discardVault, onLearning, openApp } = await import('../src/app.ts')
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-flush-'))
  let stop = () => {}
  try {
    const chatCount = 12
    const holds = Array.from({ length: chatCount }, () => hold<ReturnType<typeof draft>>())
    let calls = 0
    const app = openApp(
      directory,
      () => {
        const pending = holds[calls]
        calls += 1
        return pending.promise
      },
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const history = Array.from({ length: chatCount }, (_, index) =>
      chat(`flush-${index}`, `flush ${index}`, new Date(Date.UTC(2024, 0, index + 1)).toISOString()),
    )
    const snapshots: string[][] = []
    stop = onLearning(() => {
      try {
        const journal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
          lines: string[]
        }
        if (!journal.lines.some((line) => line.includes('flush-'))) return
        snapshots.push(journal.lines.slice())
      } catch {
        // Another test may emit after this vault is removed.
      }
    })
    const laterTurn = () => new Promise((resolve) => setImmediate(resolve))
    const cardLines = (lines: string[]) => lines.filter((line) => line.includes(' · card "')).length
    const learningLines = (lines: string[]) => lines.filter((line) => line.includes(' · learning')).length
    const journalWrites = (shots: string[][]) => {
      let writes = 0
      let previous = ''
      for (const lines of shots) {
        const text = lines.join('\n')
        if (text === previous) continue
        writes += 1
        previous = text
      }
      return writes
    }
    const running = app.runLearner(history, { foreground: true })
    assert.equal(calls, 10)
    assert.equal(snapshots.length, 1)
    assert.deepEqual(snapshots[0], [
      'Found 12 transcripts',
      ...history
        .slice()
        .sort((left, right) => (left.changedAt < right.changedAt ? 1 : left.changedAt > right.changedAt ? -1 : 0))
        .slice(0, 10)
        .map((item) => `cursor · ${item.id} · learning`),
    ])
    for (let index = 0; index < 9; index += 1) {
      holds[index].resolve(draft('Retry failed deploys'))
      await laterTurn()
      assert.equal(calls, 10)
      assert.equal(snapshots.length, 1)
      assert.equal(cardLines(snapshots[0] ?? []), 0)
    }
    holds[9].resolve(draft('Retry failed deploys'))
    await laterTurn()
    assert.equal(calls, 12)
    assert.equal(snapshots.length, 3)
    assert.equal(cardLines(snapshots[snapshots.length - 1] ?? []), 10)
    assert.equal(learningLines(snapshots[snapshots.length - 1] ?? []), 12)
    holds[10].resolve(draft('Retry failed deploys'))
    await laterTurn()
    assert.equal(snapshots.length, 3)
    assert.equal(cardLines(snapshots[snapshots.length - 1] ?? []), 10)
    holds[11].resolve(draft('Retry failed deploys'))
    const learned = await running
    assert.equal(learned.ran, true)
    assert.equal(journalWrites(snapshots), 4)
    assert.equal(snapshots.length, 5)
    const finalJournal = JSON.parse(readFileSync(join(directory, 'ingest-log.json'), 'utf8')) as {
      lines: string[]
    }
    assert.equal(finalJournal.lines.includes('Found 12 transcripts'), true)
    assert.equal(cardLines(finalJournal.lines), 12)
    assert.equal(learningLines(finalJournal.lines), 12)
  } finally {
    stop()
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})
