import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Machine, ToolId } from '../src/app.ts'

function touch(path: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

function plant(machine: Machine, id: ToolId) {
  const { home, localAppData, applications, platform } = machine
  if (platform === 'win32') {
    if (id === 'cursor') touch(join(localAppData, 'Programs', 'cursor', 'Cursor.exe'))
    if (id === 'copilot') mkdirSync(join(home, '.vscode', 'extensions', 'github.copilot-1.0.0'), { recursive: true })
    if (id === 'claude') touch(join(localAppData, 'AnthropicClaude', 'app-1.0.0', 'claude.exe'))
    if (id === 'cursor-cli') touch(join(localAppData, 'cursor-agent', 'agent.cmd'))
    if (id === 'claude-cli') touch(join(home, '.local', 'bin', 'claude.exe'))
    if (id === 'copilot-cli') touch(join(home, '.local', 'bin', 'copilot.exe'))
    return
  }
  if (id === 'cursor') mkdirSync(join(applications, 'Cursor.app'), { recursive: true })
  if (id === 'copilot') mkdirSync(join(home, '.vscode', 'extensions', 'github.copilot-1.0.0'), { recursive: true })
  if (id === 'claude') mkdirSync(join(applications, 'Claude.app'), { recursive: true })
  if (id === 'cursor-cli') touch(join(home, '.local', 'bin', 'agent'))
  if (id === 'claude-cli') touch(join(home, '.local', 'bin', 'claude'))
  if (id === 'copilot-cli') touch(join(home, '.local', 'bin', 'copilot'))
}

type SyncLearner = { ran: false; model?: undefined } | { ran: true; model: string }

/** Synchronous tests read `.ran` / `.model`. A promise means the learner did not finish in this turn. */
export function syncRun(value: SyncLearner | Promise<{ ran: true; model: string }>): SyncLearner {
  if (value instanceof Promise) throw new Error('the learner returned a promise in a synchronous test')
  return value
}

export function machineWith(
  root: string,
  installed: ToolId[],
  platform: Machine['platform'] = 'win32',
): Machine {
  const home = join(root, 'home')
  const localAppData = join(root, 'LocalAppData')
  const applications = join(root, 'Applications')
  const bin = join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(localAppData, { recursive: true })
  mkdirSync(applications, { recursive: true })
  mkdirSync(bin, { recursive: true })
  const machine: Machine = {
    platform,
    home,
    localAppData,
    path: bin,
    pathExt: '.COM;.EXE;.BAT;.CMD',
    applications,
    claudeProtocol: false,
  }
  for (const id of installed) plant(machine, id)
  return machine
}
