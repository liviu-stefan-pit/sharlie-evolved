import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KbLessonInput } from '../src/kb.ts'

export function lesson(username: string, overrides: Partial<KbLessonInput> = {}): KbLessonInput {
  const author = overrides.author ?? {
    username,
    email: `${username}@example.com`,
    team: 'platform',
  }
  return {
    scope: 'work',
    title: 'Retry failed deploys',
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: 'A deploy failed after the lock timed out.',
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    project: 'sharlie',
    sources: ['cursor'],
    created_at: '2026-11-02T08:00:00.000Z',
    ...overrides,
    author,
  }
}

const everyone = '*S-1-1-0'

function clearWriteDeny(folder: string) {
  if (process.platform !== 'win32') return
  try {
    execFileSync('icacls', [folder, '/remove:d', everyone], { stdio: 'ignore' })
  } catch {
    // The folder had no deny entry.
  }
}

export function lockFolder(folder: string) {
  if (process.platform === 'win32') {
    execFileSync('icacls', [folder, '/deny', `${everyone}:(OI)(CI)(WD,AD,DC)`], { stdio: 'ignore' })
    return () => {
      clearWriteDeny(folder)
    }
  }
  chmodSync(folder, 0o555)
  return () => {
    chmodSync(folder, 0o755)
  }
}

function relax(folder: string) {
  clearWriteDeny(folder)
  let names: string[] = []
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(folder, name)
    try {
      if (statSync(path).isDirectory()) relax(path)
    } catch {
      // Cleanup still removes the tree after permissions are restored.
    }
    try {
      chmodSync(path, 0o755)
    } catch {
      // A Windows lock is cleared by the test that took it.
    }
  }
  try {
    chmodSync(folder, 0o755)
  } catch {
    // The folder is already gone.
  }
}

export async function withFolder(run: (folder: string) => Promise<void>) {
  const folder = mkdtempSync(join(tmpdir(), 'sharlie-kb-'))
  try {
    await run(folder)
  } finally {
    relax(folder)
    rmSync(folder, { recursive: true, force: true })
  }
}
