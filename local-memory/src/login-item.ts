import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

const label = 'app.sharlie.local'
const require = createRequire(import.meta.url)

type LoginApp = {
  setLoginItemSettings: (settings: { openAtLogin: boolean; args?: string[] }) => void
}

function loginApp(): LoginApp | null {
  try {
    const loaded = require('electron') as { app?: LoginApp } | string
    if (typeof loaded === 'string' || typeof loaded.app?.setLoginItemSettings !== 'function') return null
    return loaded.app
  } catch {
    return null
  }
}

export function runningUnderTest() {
  return (
    process.execArgv.includes('--test') ||
    process.execArgv.some((arg) => arg.startsWith('--test-')) ||
    process.env.NODE_TEST_CONTEXT != null ||
    process.env.SHARLIE_SKIP_LOGIN_ITEM === '1'
  )
}

function appBinary() {
  const fromEnv = process.env.SHARLIE_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return ''
}

function quotedCommand() {
  const binary = appBinary()
  if (binary === '') return ''
  return `"${binary}" --background`
}

function launchAgent(binary: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary}</string>
    <string>--background</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
}

export function registerLoginItem() {
  if (runningUnderTest()) return
  if (process.platform === 'win32') {
    loginApp()?.setLoginItemSettings({ openAtLogin: true, args: ['--background'] })
    return
  }
  const command = quotedCommand()
  if (command === '') return
  if (process.platform === 'darwin') {
    const path = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, launchAgent(appBinary()))
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}`, path], { stdio: 'ignore' })
    } catch {
      // The agent is not loaded yet.
    }
    try {
      execFileSync('launchctl', ['bootstrap', `gui/${process.getuid?.() ?? 0}`, path], { stdio: 'ignore' })
    } catch {
      try {
        execFileSync('launchctl', ['load', path], { stdio: 'ignore' })
      } catch {
        // The plist is in place for the next login.
      }
    }
  }
}

export function unregisterLoginItem() {
  if (runningUnderTest()) return
  if (process.platform === 'win32') {
    loginApp()?.setLoginItemSettings({ openAtLogin: false })
    return
  }
  if (process.platform === 'darwin') {
    const path = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 0}`, path], { stdio: 'ignore' })
    } catch {
      try {
        execFileSync('launchctl', ['unload', path], { stdio: 'ignore' })
      } catch {
        // The agent was not loaded.
      }
    }
    if (existsSync(path)) rmSync(path)
  }
}
