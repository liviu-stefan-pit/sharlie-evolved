import { createInterface } from 'node:readline'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { openUserSession, readInstalledTranscripts } from './app.ts'
import { openDesktopHost } from './window.ts'

export async function serveDesktopHost() {
  const session = openUserSession(userInfo().username, undefined, undefined, () => readInstalledTranscripts())
  session.logIn()
  const host = await openDesktopHost({
    directory: join(homedir(), '.sharlie', 'knowledge'),
    session,
  })
  const lines = createInterface({ input: process.stdin, terminal: false })
  for await (const line of lines) {
    if (line.trim() === '') continue
    process.stdout.write(`${await host.line(line)}\n`)
  }
}
