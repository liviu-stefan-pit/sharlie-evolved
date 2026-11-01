import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRunningDesktopHost } from '../src/host.ts'
import { registerLoginItem, unregisterLoginItem } from '../src/login-item.ts'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const devUrl = 'http://127.0.0.1:1420'

process.env.SHARLIE_BIN ??= process.execPath

const registerFlag = process.argv.includes('--register-login')
const unregisterFlag = process.argv.includes('--unregister-login')
const background = process.argv.includes('--background')

let quitting = false
let window: BrowserWindow | null = null
let running: Awaited<ReturnType<typeof openRunningDesktopHost>> | null = null

function showWindow() {
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function ask(message: Record<string, unknown>) {
  if (!running) throw new Error('Sharlie host is not available')
  return JSON.parse(await running.line(JSON.stringify(message))) as unknown
}

function createWindow() {
  window = new BrowserWindow({
    title: 'Sharlie',
    width: 680,
    height: 520,
    show: !background,
    backgroundColor: '#1f1f1f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
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
  app.whenReady().then(() => {
    if (registerFlag) registerLoginItem()
    else unregisterLoginItem()
    app.exit(0)
  })
} else {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      showWindow()
    })
    app.whenReady().then(async () => {
      running = await openRunningDesktopHost()
      ipcMain.handle('state', () => ask({ cmd: 'state' }))
      ipcMain.handle('action', (_event, body: Record<string, unknown>) => ask({ ...body, cmd: 'action' }))
      ipcMain.handle('lookup', (_event, query: string) => ask({ cmd: 'lookup', query }))
      ipcMain.handle('reveal-key', () => ask({ cmd: 'reveal-key' }))
      createWindow()
      createTray()
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
