import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openApp, type LessonDraft } from '../src/app.ts'
import { machineWith } from './machine.ts'

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  try {
    run(directory)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
}

test('the window shows a label only for the installed tools', () => {
  withDirectory((directory) => {
    const app = openApp(directory, undefined, machineWith(directory, ['cursor', 'claude-cli']))
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Cursor', 'Claude CLI'],
    )
  })
})

test('the app scans for Cursor, Copilot in VS Code, Claude, Cursor CLI, Claude CLI, and Copilot CLI', () => {
  withDirectory((directory) => {
    const installed = [
      'cursor',
      'copilot',
      'claude',
      'cursor-cli',
      'claude-cli',
      'copilot-cli',
    ] as const
    const app = openApp(directory, undefined, machineWith(directory, [...installed]))
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Cursor', 'Copilot in VS Code', 'Claude', 'Cursor CLI', 'Claude CLI', 'Copilot CLI'],
    )
  })
})

test('the same six tools are found on macOS', () => {
  withDirectory((directory) => {
    const app = openApp(
      directory,
      undefined,
      machineWith(
        directory,
        ['cursor', 'copilot', 'claude', 'cursor-cli', 'claude-cli', 'copilot-cli'],
        'darwin',
      ),
    )
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Cursor', 'Copilot in VS Code', 'Claude', 'Cursor CLI', 'Claude CLI', 'Copilot CLI'],
    )
  })
})

test('Claude is listed when Windows has registered the claude protocol and no desktop executable', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, [])
    machine.claudeProtocol = true
    const app = openApp(directory, undefined, machine)
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Claude'],
    )
  })
})

test('a macOS CLI on PATH is installed even when the home bin directory is empty', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, [], 'darwin')
    writeFileSync(join(machine.path, 'claude'), '')
    const app = openApp(directory, undefined, machine)
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Claude CLI'],
    )
  })
})

test('an unrelated agent command is not treated as Cursor CLI', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, [])
    writeFileSync(join(machine.path, 'agent.cmd'), '')
    const app = openApp(directory, undefined, machine)
    assert.deepEqual(app.tools(), [])
  })
})

test('a CLI on PATH is installed even when the home bin directory is empty', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, ['cursor'])
    writeFileSync(join(machine.path, 'copilot.cmd'), '')
    const app = openApp(directory, undefined, machine)
    assert.deepEqual(
      app.tools().map((tool) => tool.label),
      ['Cursor', 'Copilot CLI'],
    )
  })
})

function draft(title: string): LessonDraft {
  return {
    scope: 'work',
    title,
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: 'A deploy failed after the lock timed out.',
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    otherNames: [],
    belongsToProject: null,
    clearlyOneProduct: true,
    subjectProject: null,
    generalTechnique: false,
  }
}

test('a tool that is not installed does not have its transcripts read', () => {
  withDirectory((directory) => {
    const app = openApp(
      directory,
      ({ transcript }) => draft(transcript.source === 'cursor' ? 'Retry failed deploys' : 'Read the lock log'),
      machineWith(directory, ['cursor']),
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner([
      { source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'read the log' },
    ])
    const folder = join(directory, 'work', 'platform')
    const files = readdirSync(folder)
    assert.equal(files.length, 1)
    const card = readFileSync(join(folder, files[0]), 'utf8')
    assert.match(card, /- cursor/)
    assert.equal(card.includes('claude'), false)
  })
})

test('turning an installed tool off skips its transcripts, and turning it back on includes them', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, ['cursor', 'claude'])
    const complete = ({ transcript }: { transcript: { source: string } }) =>
      draft(transcript.source === 'cursor' ? 'Retry failed deploys' : 'Read the lock log')
    const app = openApp(directory, complete, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.setToolEnabled('Claude', false)

    const reopened = openApp(directory, complete, machine)
    assert.equal(reopened.tools().find((tool) => tool.label === 'Claude')?.enabled, false)
    assert.equal(reopened.tools().find((tool) => tool.label === 'Cursor')?.enabled, true)
    reopened.runLearner([
      { source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'read the log' },
    ])
    const folder = join(directory, 'work', 'platform')
    let files = readdirSync(folder)
    assert.equal(files.length, 1)
    assert.match(readFileSync(join(folder, files[0]), 'utf8'), /- cursor/)

    reopened.setToolEnabled('Claude', true)
    reopened.runLearner([{ source: 'claude', text: 'read the log' }])
    files = readdirSync(folder)
    assert.equal(files.length, 2)
    const cards = files.map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(
      cards.some((card) => card.includes('- claude')),
      true,
    )
  })
})

test('each installed tool starts enabled', () => {
  withDirectory((directory) => {
    const app = openApp(
      directory,
      undefined,
      machineWith(directory, ['cursor', 'copilot', 'claude']),
    )
    assert.deepEqual(app.tools(), [
      { id: 'cursor', label: 'Cursor', enabled: true },
      { id: 'copilot', label: 'Copilot in VS Code', enabled: true },
      { id: 'claude', label: 'Claude', enabled: true },
    ])
  })
})
