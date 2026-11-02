import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRunningDesktopHost } from '../src/host.ts'
import { runSmokeLearn } from '../src/smoke-learn.ts'
import { registerLoginItem, unregisterLoginItem } from '../src/login-item.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = basename(here) === 'dist' ? join(here, '..', '..') : join(here, '..')
const preload = existsSync(join(here, 'preload.cjs')) ? join(here, 'preload.cjs') : join(here, '..', 'preload.cjs')
const devUrl = 'http://127.0.0.1:1420'

process.env.SHARLIE_BIN ??= process.execPath

const registerFlag = process.argv.includes('--register-login')
const unregisterFlag = process.argv.includes('--unregister-login')
const background = process.argv.includes('--background')
const smoke = process.argv.includes('--smoke') || process.env.SHARLIE_SMOKE === '1'

let quitting = false
let window: BrowserWindow | null = null
let running: Awaited<ReturnType<typeof openRunningDesktopHost>> | null = null
let learningInFlight = false
let learningAgain = false
let starting: Promise<void> | null = null
let startupError = ''

const HOST_START_TIMEOUT_MS = 20_000

/** One plain sentence for a failed start; the raw detail follows on its own line. */
function startupSentence(error: unknown) {
  const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
  const settings = join(homedir(), '.sharlie', 'knowledge', 'settings.json')
  if (/ENOTDIR|not a folder/.test(detail)) {
    return `Sharlie's knowledge folder at ${dirname(settings)} is a file, not a folder. Move or rename that file, then press Retry. (${detail})`
  }
  if (error instanceof SyntaxError || /JSON/.test(detail)) {
    return `Sharlie couldn't read its settings file at ${settings}. Fix or remove that file, then press Retry. (${detail})`
  }
  if (/EACCES|EPERM|EROFS|read-only/i.test(detail)) {
    return `Sharlie can't write to its settings folder at ${dirname(settings)}. Check the folder's permissions, then press Retry. (${detail})`
  }
  if (/timed out/.test(detail)) return 'Sharlie\'s background service took too long to start. Press Retry, or quit Sharlie from the tray icon and open it again.'
  return `Sharlie couldn't start its background service. Press Retry, or quit Sharlie from the tray icon and open it again. (${detail})`
}

/**
 * No blocking dialog: a modal box would stall the main process and leave the window blank.
 * The window's own service screen shows the sentence (from the rejected `state` call) with Retry.
 */
function noteStartupError(sentence: string) {
  startupError = sentence
  console.error(sentence)
}

/** Resolves once the window has loaded (or failed to), so a startup error reaches the page; never waits forever. */
function windowLoaded() {
  const target = window
  if (!target || target.isDestroyed()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 10_000)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    target.webContents.once('did-finish-load', done)
    target.webContents.once('did-fail-load', done)
  })
}

/**
 * The knowledge path must be a folder. On Windows, reading settings.json through a file reports ENOENT
 * (Linux says ENOTDIR), so without this check the host would start and then silently fail to save.
 */
function checkKnowledgeFolder() {
  const folder = join(homedir(), '.sharlie', 'knowledge')
  if (existsSync(folder) && !statSync(folder).isDirectory()) {
    throw Object.assign(new Error(`ENOTDIR: ${folder} is a file, not a folder`), { code: 'ENOTDIR' })
  }
}

/** Starts the host at most once at a time; never throws, never waits forever. */
function startHost() {
  if (running) return Promise.resolve()
  if (starting) return starting
  starting = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      checkKnowledgeFolder()
      const opened = await Promise.race([
        openRunningDesktopHost({ onLearning: sendLearningSnapshot }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Starting the background service timed out')), HOST_START_TIMEOUT_MS)
        }),
      ])
      running = opened
      startupError = ''
    } catch (error) {
      noteStartupError(startupSentence(error))
    } finally {
      if (timer) clearTimeout(timer)
      starting = null
    }
  })()
  return starting
}

function showWindow() {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function ask(message: Record<string, unknown>) {
  // A state request after a failed start (the window's Retry) tries the start again.
  if (!running && message.cmd === 'state') await startHost()
  if (!running) throw new Error(startupError || 'Sharlie host is not available')
  return JSON.parse(await running.line(JSON.stringify(message))) as unknown
}

function sendLearningSnapshot() {
  if (!window || window.isDestroyed()) return
  if (learningInFlight) {
    learningAgain = true
    return
  }
  learningInFlight = true
  void ask({ cmd: 'learning-view' })
    .then((pageState) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('learning', pageState)
      }
    })
    .catch(() => {})
    .finally(() => {
      learningInFlight = false
      if (learningAgain) {
        learningAgain = false
        sendLearningSnapshot()
      }
    })
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Sharlie',
    width: 960,
    height: 640,
    minWidth: 560,
    minHeight: 420,
    show: !background,
    backgroundColor: '#1f1f1f',
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window?.hide()
  })
  if (app.isPackaged) {
    void window.loadFile(join(appRoot, 'ui', 'dist', 'index.html'))
  } else {
    void window.loadURL(devUrl)
  }
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGwwAGBgYGAN4eBwFZq4m8AAAAAElFTkSuQmCC',
  )
  const tray = new Tray(icon)
  tray.setToolTip('Sharlie')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => showWindow() },
      { label: 'Sync Now', click: () => void ask({ cmd: 'sync' }) },
      { label: 'Pause Harvest', click: () => void ask({ cmd: 'pause' }) },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          running?.close()
          app.quit()
        },
      },
    ]),
  )
}

if (registerFlag || unregisterFlag) {
  // NSIS waits on this process. Exit even if Electron keeps the loop open.
  const forceExit = setTimeout(() => process.exit(0), 10_000)
  app.whenReady().then(() => {
    try {
      if (registerFlag) registerLoginItem()
      else unregisterLoginItem()
    } finally {
      clearTimeout(forceExit)
      app.exit(0)
      process.exit(0)
    }
  }).catch(() => {
    process.exit(0)
  })
} else if (smoke) {
  app.whenReady().then(async () => {
    if (process.env.SHARLIE_MOCK_MODEL === '1') {
      try {
        const report = await runSmokeLearn()
        console.log(JSON.stringify(report))
        if (!report.ok) {
          console.error(`SMOKE_FAIL ${report.reason ?? 'the fixture learn failed'}`)
          app.exit(1)
          return
        }
        console.log('SMOKE_OK')
        app.exit(0)
      } catch (error) {
        console.error(`SMOKE_FAIL ${error instanceof Error ? error.message : 'the host crashed'}`)
        app.exit(1)
      }
      return
    }
    try {
      createWindow()
      const opened = window
      if (!opened) throw new Error('SMOKE_FAIL Sharlie did not open a window')
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('SMOKE_FAIL the window did not load within 10s')), 10_000)
        opened.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
        opened.webContents.once('did-fail-load', (_event, code, description) => {
          clearTimeout(timer)
          reject(new Error(`SMOKE_FAIL the window failed to load (${code} ${description})`))
        })
      })
      console.log('SMOKE_OK')
      app.exit(0)
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'SMOKE_FAIL Sharlie did not open a window')
      app.exit(1)
    }
  })
} else {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      showWindow()
    })
    // A bad settings file, a read-only folder, or a slow start must never crash or hang Sharlie:
    // the window and tray open first, the host starts after, and a failure shows one sentence.
    process.on('uncaughtException', (error) => {
      console.error(error)
      if (!running) noteStartupError(startupSentence(error))
    })
    process.on('unhandledRejection', (error) => {
      console.error(error)
    })
    app.whenReady().then(async () => {
      ipcMain.handle('state', () => ask({ cmd: 'state' }))
      ipcMain.handle('action', (_event, body: Record<string, unknown>) => ask({ ...body, cmd: 'action' }))
      ipcMain.handle('lookup', (_event, query: string) => ask({ cmd: 'lookup', query }))
      ipcMain.handle('cancel-learning', () => ask({ cmd: 'cancel-learning' }))
      let loaded: Promise<void> = Promise.resolve()
      try {
        createWindow()
        loaded = windowLoaded()
        createTray()
      } catch (error) {
        noteStartupError(startupSentence(error))
      }
      await loaded
      await startHost()
    })
    app.on('before-quit', () => {
      quitting = true
      running?.close()
    })
    app.on('window-all-closed', () => {
      // Closing hides the window. The tray keeps the process alive.
    })
  }
}
