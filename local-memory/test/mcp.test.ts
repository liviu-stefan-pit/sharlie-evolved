import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { entityRelations, handleMessage, mergeSynapseConfig, searchTeamKnowledge } from '../src/mcp.ts'
import { machineWith } from './machine.ts'

const saved = {
  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USER: process.env.NEO4J_USER,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
  SHARLIE_KNOWLEDGE: process.env.SHARLIE_KNOWLEDGE,
}

function useLocalCards() {
  delete process.env.NEO4J_URI
  delete process.env.NEO4J_USER
  delete process.env.NEO4J_PASSWORD
  delete process.env.SHARLIE_KNOWLEDGE
}

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function card(directory: string) {
  const folder = join(directory, 'cards')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'card_20261031_120000.json'),
    JSON.stringify({
      id: 'card_20261031_120000',
      title: 'Retry failed deploys',
      solution: 'Retry the deploy once, then read the log.',
      created_at: '2026-10-31T12:00:00.000Z',
      sources: ['cursor'],
      failure_modes: ['A deploy failed after the lock timed out.'],
      transcript: 'SECRET TRANSCRIPT do not return',
      relations: [{ entity: 'Retry failed deploys', relation: 'APPLIES_TO', target_entity: 'cursor' }],
      author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
      context: { os: 'win32', tool_version: '', framework: '' },
    }),
  )
}

test('search and relations read cards and leave transcript text out', async () => {
  useLocalCards()
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-mcp-'))
  try {
    card(directory)
    const found = await searchTeamKnowledge('deploy', ['cursor'], directory)
    assert.deepEqual(found, [
      {
        id: 'card_20261031_120000',
        title: 'Retry failed deploys',
        solution: 'Retry the deploy once, then read the log.',
        created_at: '2026-10-31T12:00:00.000Z',
        source_type: 'cursor',
      },
    ])
    assert.equal(JSON.stringify(found).includes('SECRET TRANSCRIPT'), false)
    const relations = await entityRelations('ada', directory)
    assert.deepEqual(relations, [
      { entity: 'ada', relation: 'AUTHORED', target_entity: 'card_20261031_120000' },
      { entity: 'Retry failed deploys', relation: 'APPLIES_TO', target_entity: 'cursor' },
    ])
    assert.equal(JSON.stringify(relations).includes('SECRET TRANSCRIPT'), false)
    process.env.SHARLIE_KNOWLEDGE = directory
    const listed = await handleMessage({ method: 'tools/list' })
    assert.deepEqual(
      (listed as { tools: { name: string }[] }).tools.map((tool) => tool.name),
      ['search_team_knowledge', 'get_entity_relations'],
    )
    const called = await handleMessage({
      method: 'tools/call',
      params: { name: 'search_team_knowledge', arguments: { query: 'deploy', tags: ['cursor'] } },
    })
    const text = (called as { content: { text: string }[] }).content[0]?.text ?? ''
    assert.equal(text.includes('SECRET TRANSCRIPT'), false)
    assert.equal(text.includes('Retry the deploy once'), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
    restoreEnv()
  }
})

test('mergeSynapseConfig adds synapse beside existing servers in a temp home', () => {
  const root = mkdtempSync(join(tmpdir(), 'sharlie-home-'))
  try {
    const machine = machineWith(root, [])
    const cursor = join(machine.home, '.cursor', 'mcp.json')
    const vscode = join(machine.home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')
    const claude = join(machine.home, '.claude.json')
    const settings = join(machine.home, '.claude', 'settings.json')
    mkdirSync(join(cursor, '..'), { recursive: true })
    mkdirSync(join(vscode, '..'), { recursive: true })
    mkdirSync(join(settings, '..'), { recursive: true })
    writeFileSync(cursor, JSON.stringify({ mcpServers: { other: { command: 'other' } }, theme: 'keep' }))
    writeFileSync(vscode, JSON.stringify({ servers: { other: { command: 'code' } }, locale: 'en' }))
    writeFileSync(claude, JSON.stringify({ mcpServers: { other: { command: 'claude' } }, numStartups: 3 }))
    writeFileSync(settings, JSON.stringify({ mcpServers: { other: { command: 'settings' } }, permissions: { allow: [] } }))
    mergeSynapseConfig(machine)
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const cursorConfig = read(cursor)
    const cursorServers = cursorConfig.mcpServers as Record<string, { command: string; args?: string[] }>
    assert.equal(cursorServers.other?.command, 'other')
    assert.equal(cursorServers.synapse?.command, 'node')
    assert.equal(cursorServers.synapse?.args?.[0]?.endsWith('mcp.ts'), true)
    assert.equal(cursorConfig.theme, 'keep')
    const vscodeConfig = read(vscode)
    const vscodeServers = vscodeConfig.servers as Record<string, { command: string }>
    const vscodeMcp = vscodeConfig.mcpServers as Record<string, { command: string }>
    assert.equal(vscodeServers.other?.command, 'code')
    assert.equal(vscodeServers.synapse?.command, 'node')
    assert.equal(vscodeMcp.synapse?.command, 'node')
    assert.equal(vscodeConfig.locale, 'en')
    const claudeConfig = read(claude)
    const claudeServers = claudeConfig.mcpServers as Record<string, { command: string }>
    assert.equal(claudeServers.other?.command, 'claude')
    assert.equal(claudeServers.synapse?.command, 'node')
    assert.equal(claudeConfig.numStartups, 3)
    const settingsConfig = read(settings)
    const settingsServers = settingsConfig.mcpServers as Record<string, { command: string }>
    assert.equal(settingsServers.other?.command, 'settings')
    assert.equal(settingsServers.synapse?.command, 'node')
    assert.deepEqual((settingsConfig.permissions as { allow: unknown[] }).allow, [])
    mergeSynapseConfig(machine)
    const again = read(cursor).mcpServers as Record<string, unknown>
    assert.equal(Object.keys(again).filter((name) => name === 'synapse').length, 1)
    assert.equal(again.other !== undefined, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unreadable MCP config is left in place', () => {
  const root = mkdtempSync(join(tmpdir(), 'sharlie-home-'))
  try {
    const machine = machineWith(root, [])
    const cursor = join(machine.home, '.cursor', 'mcp.json')
    mkdirSync(join(cursor, '..'), { recursive: true })
    writeFileSync(cursor, '{')
    assert.throws(() => mergeSynapseConfig(machine), /not valid JSON/)
    assert.equal(readFileSync(cursor, 'utf8'), '{')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
