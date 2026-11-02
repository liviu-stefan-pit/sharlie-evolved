import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Starts electron/main.ts with a fake Electron and a temp HOME holding a hostile settings file,
// then reports what a person would see. Runs on Linux without Electron or a display.
const main = pathToFileURL(fileURLToPath(new URL('../electron/main.ts', import.meta.url))).href

// The fake must replace the same module main.ts resolves for 'electron'.
const electron = import.meta.resolve('electron')

const runner = `
import { mock } from 'node:test'
const events = []
const log = (entry) => events.push(entry)
let ready
const whenReady = new Promise((resolve) => { ready = resolve })
const handlers = new Map()
class BrowserWindow {
  constructor() { log('window'); this.webContents = { send() {}, once() {} } }
  on() {} loadURL() { log('load'); return Promise.resolve() } loadFile() { log('load'); return Promise.resolve() }
  isMinimized() { return false } isDestroyed() { return false } show() {} focus() {} hide() {} restore() {}
}
class Tray { constructor() { log('tray') } setToolTip() {} setContextMenu() {} }
mock.module(process.env.ELECTRON_URL, { namedExports: {
  app: {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => whenReady,
    on() {}, quit() { log('quit') }, exit(code) { log('exit:' + code) },
  },
  BrowserWindow,
  Tray,
  Menu: { buildFromTemplate: () => ({}) },
  nativeImage: { createFromDataURL: () => ({}) },
  ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
  dialog: { showErrorBox: (title, text) => log('dialog:' + title + ' | ' + text) },
} })
const watchdog = setTimeout(() => { console.log(JSON.stringify({ events, hung: true })); process.exit(0) }, 25000)
await import(process.env.MAIN_MODULE)
ready()
await new Promise((resolve) => setTimeout(resolve, 50))
let state
try {
  const reply = await handlers.get('state')?.()
  state = { ok: true, title: reply?.title }
} catch (error) {
  state = { ok: false, error: error instanceof Error ? error.message : String(error) }
}
clearTimeout(watchdog)
console.log(JSON.stringify({ events, state, hung: false }))
process.exit(0)
`

function start(prepare: (knowledge: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'sharlie-hostile-'))
  const knowledge = join(home, '.sharlie', 'knowledge')
  mkdirSync(knowledge, { recursive: true })
  const script = join(home, 'runner.mjs')
  writeFileSync(script, runner)
  try {
    prepare(knowledge)
    const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--disable-warning=ExperimentalWarning', script], {
      env: { ...process.env, HOME: home, USERPROFILE: home, MAIN_MODULE: main, ELECTRON_URL: electron, SHARLIE_SMOKE: '' },
      encoding: 'utf8',
      timeout: 40_000,
    })
    const line = run.stdout.trim().split('\n').reverse().find((item) => item.startsWith('{'))
    assert.ok(line, `no report (exit ${run.status}, signal ${run.signal}): ${run.stderr.slice(0, 400)}`)
    return { status: run.status, report: JSON.parse(line) as { events: string[]; state?: { ok: boolean; error?: string; title?: string }; hung: boolean } }
  } finally {
    chmodSync(knowledge, 0o755)
    chmodSync(join(home, '.sharlie'), 0o755)
    rmSync(home, { recursive: true, force: true })
  }
}

function assertPlainFailure(result: ReturnType<typeof start>, mention: RegExp) {
  const { status, report } = result
  assert.equal(status, 0, 'the process exits cleanly, not with a crash')
  assert.equal(report.hung, false, 'startup settles instead of hanging')
  assert.equal(report.events[0], 'window', 'the window opens before the host starts')
  assert.ok(report.events.includes('tray'))
  assert.ok(!report.events.some((event) => event.startsWith('exit:') || event === 'quit'), 'Sharlie stays running')
  const dialogs = report.events.filter((event) => event.startsWith('dialog:'))
  assert.equal(dialogs.length, 1, 'one visible error')
  assert.match(dialogs[0]!, mention)
  assert.match(dialogs[0]!, /press Retry\./)
  assert.equal(report.state?.ok, false)
  assert.match(report.state?.error ?? '', mention, 'the window gets the same sentence for its service screen')
}

test('a settings file with JSONC comments opens the window and shows one plain sentence', () => {
  const result = start((knowledge) => {
    writeFileSync(join(knowledge, 'settings.json'), '{\n  // my notes\n  "profile": { "username": "ada" }, /* trailing */\n}\n')
  })
  assertPlainFailure(result, /couldn't read its settings file/)
})

test('a truncated settings file opens the window and shows one plain sentence', () => {
  const result = start((knowledge) => {
    writeFileSync(join(knowledge, 'settings.json'), '{"profile": {"username": "ada", "ema')
  })
  assertPlainFailure(result, /couldn't read its settings file/)
})

test('a read-only settings folder never crashes or hangs startup', () => {
  const result = start((knowledge) => {
    writeFileSync(join(knowledge, 'settings.json'), '{"profile":{"username":"ada"}}')
    chmodSync(join(knowledge, 'settings.json'), 0o444)
    chmodSync(knowledge, 0o555)
  })
  const { status, report } = result
  assert.equal(status, 0)
  assert.equal(report.hung, false)
  assert.equal(report.events[0], 'window')
  assert.ok(!report.events.some((event) => event.startsWith('exit:') || event === 'quit'))
  const dialogs = report.events.filter((event) => event.startsWith('dialog:'))
  if (report.state?.ok) assert.equal(dialogs.length, 0, 'a host that opens shows no error')
  else {
    assert.equal(dialogs.length, 1)
    assert.match(report.state?.error ?? '', /press Retry\./)
  }
})
