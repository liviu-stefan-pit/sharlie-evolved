import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, onLearning, openApp, openUserSession, readInstalledTranscripts, type LessonDraft } from '../src/app.ts'
import { deleteSecret } from '../src/vault.ts'
import { openDesktopHost, setFolderPicker, setKeyProbe } from '../src/window.ts'
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
      win: { target: string[]; requestedExecutionLevel?: string }
      nsis: { oneClick?: boolean; perMachine?: boolean; allowElevation?: boolean }
      mac: { target: string[] }
      linux?: unknown
    }
  }
  const loginItem = readFileSync(new URL('../src/login-item.ts', import.meta.url), 'utf8')
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
  assert.equal(pkg.build.win.requestedExecutionLevel, 'asInvoker')
  assert.equal(pkg.build.nsis.oneClick, true)
  assert.equal(pkg.build.nsis.perMachine, false)
  assert.equal(pkg.build.nsis.allowElevation, false)
  assert.match(loginItem, /setLoginItemSettings/)
  assert.equal(loginItem.includes('schtasks'), false)
  assert.match(main, /finally\s*\{[\s\S]*app\.exit\(0\)[\s\S]*process\.exit\(0\)/)
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

test('a host started with a saved profile, key, and model is scheduled without a register action', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const prepared = openApp(directory, (request) => draft(request.transcript.text), machine)
  prepared.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  prepared.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machine, () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const state = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as { scheduled?: boolean }
    assert.equal(state.scheduled, true)
    const again = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as { scheduled?: boolean }
    assert.equal(again.scheduled, true)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('team sharing is unavailable, so the share folder is refused and nothing is stamped shared', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const share = join(directory, 'share')
  const other = join(directory, 'other-share')
  mkdirSync(share)
  mkdirSync(other)
  writeFileSync(join(share, 'keep.txt'), 'keep')
  const app = openApp(directory, (request) => draft(request.transcript.text), machine)
  app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  app.setDrivePath(share)
  app.setAutoDrop(true)
  app.runLearner([{ source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' }])
  assert.equal(app.share(), true)
  assert.equal(app.lastSharedAt(), '')
  assert.deepEqual(readdirSync(share), ['keep.txt'])
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machine, () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const first = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as {
      share?: boolean
      autoDrop?: boolean
      shareAvailable?: boolean
      lastSharedAt?: string | null
      drivePath?: string
    }
    assert.equal(first.share, false)
    assert.equal(first.autoDrop, false)
    assert.equal(first.shareAvailable, false)
    assert.equal(first.lastSharedAt, null)
    assert.equal(first.drivePath, share)

    const missing = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-share', enabled: 'true' })),
    ) as { errorCode?: string; notice?: string; share?: boolean }
    assert.equal(missing.errorCode, 'share_unavailable')
    assert.equal(missing.notice, 'Team sharing is not available in this version.')
    assert.equal(missing.share, false)

    const driven = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-drive', path: other })),
    ) as { errorCode?: string; notice?: string; drivePath?: string }
    assert.equal(driven.errorCode, 'share_unavailable')
    assert.equal(driven.notice, 'Team sharing is not available in this version.')
    assert.equal(driven.drivePath, share)
    assert.deepEqual(readdirSync(share), ['keep.txt'])
    assert.deepEqual(readdirSync(other), [])

    let picks = 0
    setFolderPicker(() => {
      picks += 1
      return other
    })
    const picked = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'pick-folder', purpose: 'share' })),
    ) as { errorCode?: string; notice?: string; share?: boolean; drivePath?: string }
    assert.equal(picked.errorCode, 'share_unavailable')
    assert.equal(picked.notice, 'Team sharing is not available in this version.')
    assert.equal(picked.share, false)
    assert.equal(picked.drivePath, share)
    assert.equal(picks, 0)
    assert.deepEqual(readdirSync(share), ['keep.txt'])
    assert.deepEqual(readdirSync(other), [])

    const enabled = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-auto-drop', enabled: 'true' })),
    ) as { errorCode?: string; notice?: string; share?: boolean }
    assert.equal(enabled.errorCode, 'share_unavailable')
    assert.equal(enabled.notice, 'Team sharing is not available in this version.')
    assert.equal(enabled.share, false)

    mkdirSync(join(directory, 'cards'), { recursive: true })
    const card = (id: string, scope?: string) =>
      JSON.stringify({
        id,
        title: id,
        scope,
        topics: [],
        sources: [],
        relations: [],
        failure_modes: [],
        solution: id,
        author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
      })
    writeFileSync(join(directory, 'cards', 'card_work.json'), card('card_work', 'work'))
    writeFileSync(join(directory, 'cards', 'card_work.md'), 'work')
    writeFileSync(join(directory, 'cards', 'card_personal.json'), card('card_personal', 'personal'))
    writeFileSync(join(directory, 'cards', 'card_plain.json'), card('card_plain'))
    session.install(directory)
    const after = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as {
      lastSharedAt?: string | null
      share?: boolean
      shareAvailable?: boolean
    }
    assert.equal(after.share, false)
    assert.equal(after.shareAvailable, false)
    assert.equal(after.lastSharedAt, null)
    const names = readdirSync(share)
    assert.equal(names.includes('Dropzone'), false)
    assert.equal(names.some((name) => name.startsWith('card_')), false)
  } finally {
    setFolderPicker(null)
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('an empty rerun finishes with 0 lessons, no model call, and lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', 'chat', 'chat.jsonl')
  mkdirSync(join(chat, '..'), { recursive: true })
  writeFileSync(chat, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'retry the deploy' }] } }))
  let calls = 0
  const session = openUserSession(
    'ada',
    (request) => {
      calls += 1
      return draft(request.transcript.text)
    },
    machine,
    () => readInstalledTranscripts(machine),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(
      JSON.stringify({
        cmd: 'action',
        action: 'save-profile',
        username: 'ada',
        email: 'ada@example.com',
        team: 'platform',
      }),
    )
    await host.line(
      JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }),
    )
    const first = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      learning?: { active?: boolean } | null
      learningResult?: { lessons: number; chats: number; text: string } | null
      lastLearnedAt?: string | null
    }
    assert.equal(first.learning, null)
    assert.equal(calls, 1)
    assert.deepEqual(first.learningResult, { lessons: 1, chats: 1, text: '1 lesson learned' })
    assert.match(first.lastLearnedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)

    const seen: boolean[] = []
    const stop = onLearning((progress) => seen.push(progress.active))
    const again = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      learning?: { active?: boolean } | null
      learningResult?: { lessons: number; chats: number; text: string } | null
      lastLearnedAt?: string | null
    }
    stop()
    assert.equal(seen.includes(true), false)
    assert.equal(calls, 1)
    assert.equal(again.learning, null)
    assert.deepEqual(again.learningResult, { lessons: 0, chats: 0, text: '0 lessons learned' })
    assert.match(again.lastLearnedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)

    const reopened = openApp(directory, () => draft('unused'), machine)
    assert.equal(reopened.lastLearnedAt(), again.lastLearnedAt)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('a key check that times out still saves the key', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    setKeyProbe(async (_url, init) => {
      assert.ok(init?.signal instanceof AbortSignal)
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const saved = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-slow' })),
    ) as { notice?: string; errorCode?: string; savedProviders?: string[] }
    assert.equal(saved.errorCode, 'key_unchecked')
    assert.equal(saved.notice, 'The key was saved. Sharlie could not reach Anthropic to check it.')
    assert.equal(saved.savedProviders?.includes('anthropic'), true)
    assert.equal(JSON.stringify(saved).includes('sk-ant-api03-slow'), false)
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
    assert.deepEqual(reply.learning, {
      active: false,
      done: 0,
      total: 0,
      error: 'Save your username, email, and team before learning can write cards.',
      errorCode: 'profile_incomplete',
      tokens: 0,
      unreported: 0,
    })
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

function plantChats(machine: ReturnType<typeof machineWith>, names: string[]) {
  for (const name of names) {
    const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', name, `${name}.jsonl`)
    mkdirSync(join(chat, '..'), { recursive: true })
    writeFileSync(chat, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: `unread ${name}` }] } }))
  }
}

function failureSlice(reply: {
  notice?: string
  errorCode?: string
  lastLearnedAt?: string | null
  learning?: { active?: boolean; done?: number; total?: number; error?: string; errorCode?: string; lessons?: number } | null
  learningResult?: unknown
}) {
  return {
    notice: reply.notice ?? '',
    errorCode: reply.errorCode ?? '',
    lastLearnedAt: reply.lastLearnedAt ?? null,
    learningResult: reply.learningResult ?? null,
    learning: reply.learning
      ? {
          active: reply.learning.active === true,
          done: reply.learning.done ?? 0,
          total: reply.learning.total ?? 0,
          error: reply.learning.error ?? '',
          errorCode: reply.learning.errorCode ?? '',
        }
      : null,
  }
}

test('learn now with no key keeps a non-active error snapshot and does not move lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  plantChats(machine, ['one', 'two'])
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  const session = openUserSession('ada', () => draft('should not learn'), machine, () => readInstalledTranscripts(machine))
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' })))
    const slice = failureSlice(reply)
    assert.deepEqual(slice, {
      notice: 'Turn on a provider before learning can write cards.',
      errorCode: 'key_missing',
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      learningResult: null,
      learning: {
        active: false,
        done: 0,
        total: 0,
        error: 'Turn on a provider before learning can write cards.',
        errorCode: 'key_missing',
      },
    })
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('saving a key clears a key_missing learn error and leaves lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  plantChats(machine, ['one', 'two'])
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  const session = openUserSession('ada', () => draft('should not learn'), machine, () => readInstalledTranscripts(machine))
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const failed = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      learning?: { error?: string; errorCode?: string } | null
    }
    assert.equal(failed.learning?.errorCode, 'key_missing')
    const saved = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })),
    ) as {
      notice?: string
      errorCode?: string
      lastLearnedAt?: string | null
      learningResult?: unknown
      learning?: { error?: string; errorCode?: string } | null
    }
    assert.equal(saved.notice, '')
    assert.equal(saved.errorCode, undefined)
    assert.equal(saved.lastLearnedAt, '2020-01-01T00:00:00.000Z')
    assert.equal(saved.learningResult, null)
    assert.equal(saved.learning, null)
    const again = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as {
      lastLearnedAt?: string | null
      learning?: { error?: string } | null
    }
    assert.equal(again.learning, null)
    assert.equal(again.lastLearnedAt, '2020-01-01T00:00:00.000Z')
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { lastLearnedAt?: string }
    assert.equal(stored.lastLearnedAt, '2020-01-01T00:00:00.000Z')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('turning a provider on clears a key_missing learn error and leaves lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  plantChats(machine, ['one', 'two'])
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  const session = openUserSession('ada', () => draft('should not learn'), machine, () => readInstalledTranscripts(machine))
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    await host.line(JSON.stringify({ cmd: 'action', action: 'clear-provider' }))
    const failed = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      learning?: { errorCode?: string } | null
    }
    assert.equal(failed.learning?.errorCode, 'key_missing')
    const turnedOn = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'activate-provider', provider: 'anthropic' })),
    ) as {
      lastLearnedAt?: string | null
      learning?: { error?: string; errorCode?: string } | null
      provider?: string
    }
    assert.equal(turnedOn.provider, 'anthropic')
    assert.equal(turnedOn.learning, null)
    assert.equal(turnedOn.lastLearnedAt, '2020-01-01T00:00:00.000Z')
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { lastLearnedAt?: string }
    assert.equal(stored.lastLearnedAt, '2020-01-01T00:00:00.000Z')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('learn now with a missing key secret reports secret_missing and does not move lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  plantChats(machine, ['one', 'two'])
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  let calls = 0
  const session = openUserSession(
    'ada',
    () => {
      calls += 1
      return draft('should not learn')
    },
    machine,
    () => readInstalledTranscripts(machine),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    const saved = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      vaultId: string
      keys: { id: string; active: boolean }[]
    }
    const keyId = saved.keys.find((key) => key.active)?.id
    assert.equal(typeof keyId, 'string')
    deleteSecret(saved.vaultId, keyId ?? '')
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' })))
    const slice = failureSlice(reply)
    const notice = `No secret stored for key ${keyId}`
    assert.equal(calls, 0)
    assert.deepEqual(slice, {
      notice,
      errorCode: 'secret_missing',
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      learningResult: null,
      learning: {
        active: false,
        done: 0,
        total: 2,
        error: notice,
        errorCode: 'secret_missing',
      },
    })
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { lastLearnedAt?: string }
    assert.equal(stored.lastLearnedAt, '2020-01-01T00:00:00.000Z')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('learn now with a model error reports model_error and does not move lastLearnedAt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  plantChats(machine, ['one', 'two'])
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      profile: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    }),
  )
  const session = openUserSession(
    'ada',
    () => {
      throw new Error('model timed out')
    },
    machine,
    () => readInstalledTranscripts(machine),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' })))
    const slice = failureSlice(reply)
    assert.deepEqual(slice, {
      notice: 'model timed out',
      errorCode: 'model_error',
      lastLearnedAt: '2020-01-01T00:00:00.000Z',
      learningResult: null,
      learning: {
        active: false,
        done: 0,
        total: 2,
        error: 'model timed out',
        errorCode: 'model_error',
      },
    })
    const stored = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as { lastLearnedAt?: string }
    assert.equal(stored.lastLearnedAt, '2020-01-01T00:00:00.000Z')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('a fresh host reports 1h, and set-cadence 15m is refused', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const fresh = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as { cadence?: string }
    assert.equal(fresh.cadence, '1h')

    const refused = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-cadence', cadence: '15m' })),
    ) as { errorCode?: string; notice?: string; cadence?: string }
    assert.equal(refused.errorCode, 'cadence_too_short')
    assert.equal(refused.notice, 'The schedule cannot be shorter than 1 hour.')
    assert.equal(refused.cadence, '1h')

    const halfHour = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-cadence', cadence: '30m' })),
    ) as { errorCode?: string; cadence?: string }
    assert.equal(halfHour.errorCode, 'cadence_too_short')
    assert.equal(halfHour.cadence, '1h')

    const manual = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-cadence', cadence: 'manual' })),
    ) as { errorCode?: string; cadence?: string }
    assert.equal(manual.errorCode, undefined)
    assert.equal(manual.cadence, 'manual')

    const stillManual = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-cadence', cadence: '15m' })),
    ) as { errorCode?: string; cadence?: string }
    assert.equal(stillManual.errorCode, 'cadence_too_short')
    assert.equal(stillManual.cadence, 'manual')

    const shortInterval = JSON.parse(
      await host.line(JSON.stringify({ cmd: 'action', action: 'set-learner-interval', hours: '0.5' })),
    ) as { errorCode?: string; cadence?: string }
    assert.equal(shortInterval.errorCode, 'cadence_too_short')
    assert.equal(shortInterval.cadence, 'manual')
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('saved 15m and 30m settings load as 1h', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  writeFileSync(
    join(directory, 'settings.json'),
    JSON.stringify({ learnerIntervalMs: 15 * 60 * 1000, publisherIntervalMs: 30 * 60 * 1000 }),
  )
  const session = openUserSession('ada', (request) => draft(request.transcript.text), machineWith(machineRoot(directory), ['cursor']), () => [])
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    const state = JSON.parse(await host.line(JSON.stringify({ cmd: 'state' }))) as { cadence?: string }
    assert.equal(state.cadence, '1h')
    const saved = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
      learnerIntervalMs?: number
      publisherIntervalMs?: number
    }
    assert.equal(saved.learnerIntervalMs, 60 * 60 * 1000)
    assert.equal(saved.publisherIntervalMs, 60 * 60 * 1000)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('the first pass learns the newest 50 chats, cuts a long chat to 30000 characters, and later passes learn only new chats', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const machine = machineWith(machineRoot(directory), ['cursor'])
  const long = `${'x'.repeat(99_997)}END`
  for (let index = 0; index < 60; index += 1) {
    const name = String(index).padStart(2, '0')
    const chat = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', name, `${name}.jsonl`)
    mkdirSync(join(chat, '..'), { recursive: true })
    const body = index === 59 ? long : index < 10 ? `old ${index}` : `new ${index}`
    writeFileSync(chat, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: body }] } }))
    const when = new Date(Date.UTC(2020, 0, 1, 0, index))
    utimesSync(chat, when, when)
  }
  const seen: string[] = []
  const session = openUserSession(
    'ada',
    (request) => {
      seen.push(request.transcript.text)
      return draft('lesson')
    },
    machine,
    () => readInstalledTranscripts(machine),
  )
  session.logIn()
  try {
    const host = await openDesktopHost({ directory, session })
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' }))
    await host.line(JSON.stringify({ cmd: 'action', action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' }))
    const progress: { done: number; total: number }[] = []
    const stop = onLearning((event) => progress.push({ done: event.done, total: event.total }))
    const reply = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      notice?: string
      learningResult?: { lessons: number; chats: number; text: string } | null
      learning?: {
        active?: boolean
        done?: number
        total?: number
        cappedChats?: number
        deferredChats?: number
        notice?: string
        tokens?: number
        unreported?: number
      } | null
    }
    stop()
    assert.equal(seen.length, 50)
    assert.equal(seen.some((text) => text.startsWith('old ')), false)
    for (let index = 10; index < 59; index += 1) assert.equal(seen.includes(`new ${index}`), true)
    const cut = seen.find((text) => text.endsWith('END'))
    assert.equal(cut, long.slice(-30_000))
    assert.equal(cut?.length, 30_000)
    assert.equal(progress.every((event) => event.total === 50), true)
    assert.equal(progress.some((event) => event.done === 50 && event.total === 50), true)
    assert.equal(reply.notice, '')
    assert.deepEqual(reply.learningResult, { lessons: 50, chats: 50, text: '50 lessons learned' })
    assert.deepEqual(reply.learning, {
      active: false,
      done: 50,
      total: 50,
      cappedChats: 1,
      deferredChats: 10,
      notice: 'Learned the newest 50 chats. Older chats stay unread; later passes learn only new chats. 1 chat was cut to its newest 30,000 characters.',
      tokens: 0,
      unreported: 0,
    })

    await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))
    assert.equal(seen.length, 50)

    const added = join(machine.home, '.cursor', 'projects', 'sharlie', 'agent-transcripts', 'fresh', 'fresh.jsonl')
    mkdirSync(join(added, '..'), { recursive: true })
    writeFileSync(added, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'brand new chat' }] } }))
    const later = new Date(Date.UTC(2024, 0, 1))
    utimesSync(added, later, later)
    await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))
    assert.deepEqual(seen.slice(50), ['brand new chat'])
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
