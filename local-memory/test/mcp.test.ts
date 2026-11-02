import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

test('mergeSynapseConfig writes nothing: no MCP config is created or changed in a temp home', () => {
  const root = mkdtempSync(join(tmpdir(), 'sharlie-home-'))
  try {
    const machine = machineWith(root, [])
    const cursor = join(machine.home, '.cursor', 'mcp.json')
    const vscode = join(machine.home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')
    const claude = join(machine.home, '.claude.json')
    const settings = join(machine.home, '.claude', 'settings.json')
    mkdirSync(join(cursor, '..'), { recursive: true })
    mkdirSync(join(settings, '..'), { recursive: true })
    const before = {
      [cursor]: JSON.stringify({ mcpServers: { other: { command: 'other' } } }),
      [claude]: '{\n  // a comment\n  "numStartups": 3\n}',
      [settings]: '{',
    }
    for (const [path, text] of Object.entries(before)) writeFileSync(path, text)
    mergeSynapseConfig(machine)
    mergeSynapseConfig()
    for (const [path, text] of Object.entries(before)) assert.equal(readFileSync(path, 'utf8'), text, path)
    assert.equal(existsSync(vscode), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
