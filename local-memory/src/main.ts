import { spawn } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { openUserSession } from './app.ts'
import { desktopCommand, launchApp } from './window.ts'

const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : null
if (!platform) throw new Error('The app launches on Windows and macOS')

const session = openUserSession(userInfo().username)
session.logIn()
await launchApp({
  platform,
  directory: join(homedir(), '.sharlie', 'knowledge'),
  session,
  open(url) {
    const launched = desktopCommand(platform, url)
    spawn(launched.command, launched.args, { detached: true, stdio: 'ignore' }).unref()
  },
})
