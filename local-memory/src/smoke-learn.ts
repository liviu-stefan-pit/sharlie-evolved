import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discardVault, learningProgress, type Machine } from './app.ts'
import { mockModelCallCount, openRunningDesktopHost, resetMockModelCalls } from './host.ts'

const plantedSecret = 'sk-ant-api03-supersecretkey'

export type SmokeLearnReport = {
  ok: boolean
  cards: number
  calls: number
  rerunCalls: number
  secretFound: boolean
  scheduled: boolean
  reason?: string
}

function smokeMachine(root: string): Machine {
  const home = join(root, 'home')
  const localAppData = join(root, 'LocalAppData')
  const applications = join(root, 'Applications')
  mkdirSync(home, { recursive: true })
  mkdirSync(localAppData, { recursive: true })
  mkdirSync(applications, { recursive: true })
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  if (platform === 'win32') {
    const cursor = join(localAppData, 'Programs', 'cursor', 'Cursor.exe')
    mkdirSync(join(cursor, '..'), { recursive: true })
    writeFileSync(cursor, '')
  } else {
    mkdirSync(join(applications, 'Cursor.app'), { recursive: true })
  }
  const chat = join(home, '.cursor', 'projects', 'smoke', 'agent-transcripts', 'chat', 'chat.jsonl')
  mkdirSync(join(chat, '..'), { recursive: true })
  writeFileSync(
    chat,
    JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: `retry the deploy. key ${plantedSecret}` }] },
    }),
  )
  return {
    platform,
    home,
    localAppData,
    path: '',
    pathExt: '.COM;.EXE;.BAT;.CMD',
    applications,
    claudeProtocol: false,
  }
}

async function settle() {
  const started = Date.now()
  while (Date.now() - started < 5000) {
    const progress = learningProgress()
    if (progress && !progress.active && progress.total > 0 && progress.done === progress.total) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('learning did not finish')
}

function cardText(directory: string) {
  const folder = join(directory, 'cards')
  const names = readdirSync(folder).filter((name) => name.endsWith('.md') || name.endsWith('.json'))
  return {
    count: names.filter((name) => name.endsWith('.md')).length,
    text: names.map((name) => readFileSync(join(folder, name), 'utf8')).join('\n'),
  }
}

/** First-run learn against a fixture chat. Used by the packaged `--smoke` path only. */
export async function runSmokeLearn(): Promise<SmokeLearnReport> {
  const root = mkdtempSync(join(tmpdir(), 'sharlie-smoke-'))
  const machine = smokeMachine(root)
  const directory = join(root, 'knowledge')
  mkdirSync(directory, { recursive: true })
  resetMockModelCalls()
  const host = await openRunningDesktopHost({ machine, directory, mockModel: true })
  try {
    const profile = JSON.parse(
      await host.line(
        JSON.stringify({
          cmd: 'action',
          action: 'save-profile',
          username: 'ada',
          email: 'ada@example.com',
          team: 'platform',
        }),
      ),
    ) as { notice?: string }
    if (profile.notice) return { ok: false, cards: 0, calls: 0, rerunCalls: 0, secretFound: false, scheduled: false, reason: profile.notice }
    const saved = JSON.parse(
      await host.line(
        JSON.stringify({
          cmd: 'action',
          action: 'save-key',
          provider: 'anthropic',
          secret: 'sk-ant-api03-aaaa',
        }),
      ),
    ) as { notice?: string; scheduled?: boolean }
    if (saved.notice) return { ok: false, cards: 0, calls: 0, rerunCalls: 0, secretFound: false, scheduled: false, reason: saved.notice }
    const scheduled = saved.scheduled === true
    const started = JSON.parse(await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))) as {
      notice?: string
    }
    if (started.notice) return { ok: false, cards: 0, calls: 0, rerunCalls: 0, secretFound: false, scheduled, reason: started.notice }
    await settle()
    const calls = mockModelCallCount()
    const first = cardText(directory)
    await host.line(JSON.stringify({ cmd: 'action', action: 'start-learning' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const rerunCalls = mockModelCallCount() - calls
    const secretFound = first.text.includes(plantedSecret)
    const ok = first.count === 1 && calls === 1 && rerunCalls === 0 && !secretFound && scheduled
    return {
      ok,
      cards: first.count,
      calls,
      rerunCalls,
      secretFound,
      scheduled,
      reason: ok ? undefined : scheduled ? 'the fixture learn did not write one clean card' : 'the learning timer was not registered',
    }
  } finally {
    host.close()
    discardVault(directory)
    rmSync(root, { recursive: true, force: true })
  }
}
