import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openUserSession, readInstalledTranscripts, type LessonDraft } from '../src/app.ts'
import { openDesktopHost, setKeyProbe } from '../src/window.ts'
import { machineWith } from './machine.ts'

function draft(
  title: string,
  scope: LessonDraft['scope'] = 'work',
  overrides: Partial<LessonDraft> = {},
): LessonDraft {
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
    ...overrides,
  }
}

function machineRoot(directory: string) {
  return join(tmpdir(), `sharlie-machine-${directory.split(/[/\\]/).pop()}`)
}

function listeningSockets() {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .filter((line) => line.includes('LISTENING') && line.trim().endsWith(String(process.pid)))
}

test('the window host renders Sharlie and applies a form without listening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession(
    'ada',
    (request) => draft(request.transcript.text),
    machineWith(machineRoot(directory), ['cursor']),
    () => [],
  )
  session.logIn()
  const before = listeningSockets()
  try {
    const host = await openDesktopHost({ directory, session })
    const state = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as {
      title: string
      profile: { username: string; email: string; team: string }
    }
    assert.equal(state.title, 'Sharlie')
    assert.deepEqual(state.profile, { username: '', email: '', team: '' })
    assert.equal(Object.hasOwn(state, 'html'), false)

    const saved = JSON.parse(
      await host.line(
        JSON.stringify({
          cmd: 'action',
          action: 'save-profile',
          username: 'ada',
          email: 'ada@example.com',
          team: 'platform',
        }),
      ),
    ) as {
      title: string
      profile: { username: string; email: string; team: string }
      notice: string
    }
    assert.equal(saved.title, 'Sharlie')
    assert.deepEqual(saved.profile, {
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
    })
    assert.equal(saved.notice, '')
    assert.equal(Object.hasOwn(saved, 'html'), false)
    assert.deepEqual(listeningSockets(), before)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('an empty cursor expiry adds no date and the secret stays out of the window', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession(
    'ada',
    (request) => draft(request.transcript.text),
    machineWith(machineRoot(directory), ['cursor']),
    () => [],
    async () => ({ models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }], expiresAt: '' }),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const saved = JSON.parse(
      await host.line(
        JSON.stringify({
          cmd: 'action',
          action: 'save-key',
          provider: 'cursor',
          secret: 'cursor-secret-value',
        }),
      ),
    ) as { keyExpiresAt?: string; notice?: string }
    assert.equal(saved.notice, '')
    assert.equal(saved.keyExpiresAt, '')
    const text = JSON.stringify(saved)
    assert.equal(text.includes('cursor-secret-value'), false)
    assert.equal(text.includes('createdAt'), false)
    assert.equal(text.includes('keyMask'), false)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('the desktop window is an Electron shell titled Sharlie', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    build: {
      appId: string
      productName: string
      win: { target: string[] }
      mac: { target: string[] }
      linux?: unknown
    }
  }
  const installer = readFileSync(new URL('../electron/installer.nsh', import.meta.url), 'utf8')
  assert.match(main, /title:\s*'Sharlie'/)
  assert.match(main, /width:\s*960/)
  assert.match(main, /height:\s*640/)
  assert.match(main, /minWidth:\s*560/)
  assert.match(main, /minHeight:\s*420/)
  assert.match(main, /isPackaged/)
  assert.match(main, /ui',\s*'dist'/)
  assert.match(main, /127\.0\.0\.1:1420/)
  const packaged = main.slice(main.indexOf('isPackaged'))
  assert.match(packaged, /loadFile/)
  assert.equal(packaged.includes('127.0.0.1'), false)
  assert.equal(pkg.build.appId, 'app.sharlie.local')
  assert.equal(pkg.build.productName, 'Sharlie')
  assert.deepEqual(pkg.build.win.target, ['nsis'])
  assert.deepEqual(pkg.build.mac.target, ['dmg'])
  assert.equal(pkg.build.linux, undefined)
  assert.match(installer, /--register-login/)
  assert.match(installer, /--unregister-login/)
  assert.match(main, /cancel-learning/)
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /cancelLearning:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('cancel-learning'\)/)
})

test('recheck-sources reports chats it found and does not start learning', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', 'chat', 'chat.jsonl')
  mkdirSync(join(chat, '..'), { recursive: true })
  writeFileSync(
    chat,
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'retry the deploy' }] } }),
  )
  let modelCalls = 0
  const session = openUserSession(
    'ada',
    () => {
      modelCalls += 1
      return draft('should not run')
    },
    machine,
    () => [],
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'recheck-sources' }))) as {
      sources: { tool: string; path: string; chats: number }[]
      searched: { tool: string; path: string }[]
      chatsFound: number
      learning: unknown
      notice?: string
    }
    assert.equal(modelCalls, 0)
    assert.equal(reply.learning, null)
    assert.equal(reply.notice ?? '', '')
    assert.equal(reply.chatsFound, 1)
    assert.deepEqual(
      reply.sources.filter((source) => source.chats > 0),
      [{ tool: 'Cursor', path: join(machine.home, '.cursor', 'projects'), chats: 1 }],
    )
    assert.ok(reply.searched.some((folder) => folder.path === join(machine.home, '.cursor', 'plans')))
    assert.equal(reply.searched.length > reply.sources.length, true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('cancel-learning while nothing is running returns the snapshot and no error', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession(
    'ada',
    (request) => draft(request.transcript.text),
    machineWith(machineRoot(directory), ['cursor']),
    () => [],
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'cancel-learning' }))) as {
      notice?: string
      errorCode?: string
      learning: unknown
      learningResult: unknown
    }
    assert.equal(reply.notice ?? '', '')
    assert.equal(reply.errorCode ?? '', '')
    assert.equal(reply.learning, null)
    assert.equal(reply.learningResult, null)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('an unknown action returns an error instead of a silent success', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'not-a-command' }))) as {
      notice?: string
      errorCode?: string
    }
    assert.equal(reply.errorCode, 'unknown_action')
    assert.equal(reply.notice, 'That action is not available.')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('a rejected key is not saved, and a network failure still saves it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    setKeyProbe(async (_url, init) => {
      const header = `${init?.headers?.['x-api-key'] ?? ''} ${init?.headers?.authorization ?? ''}`
      if (header.includes('sk-ant-api03-bad')) return { ok: false, status: 401 }
      if (header.includes('sk-proj-bbbb')) throw new Error('getaddrinfo ENOTFOUND api.openai.com')
      return { ok: true, status: 200 }
    })
    const rejected = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-bad' })),
    ) as { notice?: string; errorCode?: string; savedProviders?: string[] }
    assert.equal(rejected.errorCode, 'key_rejected')
    assert.equal(rejected.notice, 'That key was rejected by Anthropic. Check it and try again')
    assert.equal(rejected.savedProviders?.includes('anthropic'), false)

    const saved = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })),
    ) as { notice?: string; errorCode?: string; savedProviders?: string[] }
    assert.equal(saved.errorCode, 'key_unchecked')
    assert.equal(saved.notice, 'The key was saved. Sharlie could not reach OpenAI to check it.')
    assert.equal(saved.savedProviders?.includes('openai'), true)
    assert.equal(JSON.stringify(saved).includes('sk-proj-bbbb'), false)
  } finally {
    setKeyProbe(null)
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('start-learning with no chats does not mark learning active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' }))
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      notice?: string
      errorCode?: string
      learning: unknown
    }
    assert.equal(reply.errorCode, 'no_chats')
    assert.equal(reply.notice, 'No AI coding chats were found. Sharlie looks in Cursor, Copilot, and Claude.')
    assert.equal(reply.learning, null)
    const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { learningStarted?: boolean }
    assert.equal(settings.learningStarted, false)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('a hand-made card with no context does not fail start-learning', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', 'chat', 'chat.jsonl')
  mkdirSync(join(chat, '..'), { recursive: true })
  writeFileSync(chat, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'retry the deploy' }] } }))
  mkdirSync(join(directory, 'cards'), { recursive: true })
  writeFileSync(join(directory, 'cards', 'card_broken.json'), '{')
  writeFileSync(
    join(directory, 'cards', 'card_handmade.json'),
    JSON.stringify({
      id: 'card_handmade',
      title: 'Handmade note',
      topics: [],
      solution: 'keep',
      failure_modes: [],
      relations: [],
      sources: ['cursor'],
      created_at: '2026-01-01T00:00:00.000Z',
      author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machine, () =>
    readInstalledTranscripts(machine),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' }))
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      notice?: string
      errorCode?: string
      detail?: string
      learning?: unknown
    }
    assert.equal(reply.notice ?? '', '')
    assert.equal(reply.errorCode ?? '', '')
    assert.equal(reply.detail ?? '', '')
    assert.equal(reply.learning ?? null, null)
    const names = readdirSync(join(directory, 'cards'))
    assert.equal(names.includes('card_handmade.json'), true)
    assert.equal(names.includes('card_broken.json'), true)
    assert.equal(
      names.some((name) => name.endsWith('.md') && name.startsWith('card_')),
      true,
    )
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('start-learning without a profile returns profile_incomplete and does not start', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', 'chat', 'chat.jsonl')
  mkdirSync(join(chat, '..'), { recursive: true })
  writeFileSync(chat, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'retry the deploy' }] } }))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machine, () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      notice?: string
      errorCode?: string
      learning: unknown
    }
    assert.equal(reply.errorCode, 'profile_incomplete')
    assert.equal(reply.notice, 'Save your username, email, and team before learning can write cards.')
    assert.equal(reply.learning, null)
    const settingsPath = join(directory, 'settings.json')
    const started = existsSync(settingsPath)
      ? (JSON.parse(readFileSync(settingsPath, 'utf8')) as { learningStarted?: boolean }).learningStarted === true
      : false
    assert.equal(started, false)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('a broken host line returns a plain sentence and the raw detail', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line('{')) as { notice?: string; detail?: string }
    assert.equal(reply.notice, 'Something went wrong on this PC. Try again. If it keeps happening, open Details')
    assert.equal(typeof reply.detail, 'string')
    assert.equal((reply.detail ?? '').length > 0, true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})
