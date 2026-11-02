import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openUserSession, type LessonDraft } from '../src/app.ts'
import { openDesktopHost } from '../src/window.ts'
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
