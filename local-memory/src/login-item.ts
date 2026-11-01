import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const taskName = 'Sharlie'
const runName = 'Sharlie'
const label = 'app.sharlie.local'
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

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
  const command = quotedCommand()
  if (command === '') return
  if (process.platform === 'win32') {
    execFileSync('schtasks', ['/Create', '/TN', taskName, '/SC', 'ONLOGON', '/TR', command, '/F'], {
      stdio: 'ignore',
    })
    return
  }
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
    try {
      execFileSync('schtasks', ['/Delete', '/TN', taskName, '/F'], { stdio: 'ignore' })
    } catch {
      // The task was not registered.
    }
    try {
      execFileSync('reg', ['delete', runKey, '/v', runName, '/f'], { stdio: 'ignore' })
    } catch {
      // The Run value was not registered.
    }
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
