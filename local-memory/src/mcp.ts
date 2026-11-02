import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Machine } from './app.ts'
import { readCards, type SynapseCard } from './synapse.ts'

type ToolResult = { content: { type: 'text'; text: string }[] }

function thisMachine(): Machine {
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  const home = homedir()
  return {
    platform,
    home,
    localAppData: process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'),
    path: process.env.PATH || '',
    pathExt: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
    applications: '/Applications',
    claudeProtocol: false,
  }
}

function roaming(machine: Machine) {
  if (machine.platform === 'darwin') return join(machine.home, 'Library', 'Application Support')
  return join(machine.home, 'AppData', 'Roaming')
}

function knowledgeDirectory(machine: Machine = thisMachine()) {
  if (process.env.SHARLIE_KNOWLEDGE) return process.env.SHARLIE_KNOWLEDGE
  try {
    const registry = JSON.parse(readFileSync(join(machine.home, '.sharlie', `${userInfo().username}.json`), 'utf8')) as {
      knowledge?: unknown
    }
    if (typeof registry.knowledge === 'string' && registry.knowledge.trim() !== '') return registry.knowledge
  } catch {
    // The registry is absent until the app is installed.
  }
  return join(machine.home, '.sharlie', 'knowledge')
}

function readConfig(path: string) {
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8').trim()
  if (raw === '') return {}
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`MCP config is not valid JSON: ${path}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MCP config is not a JSON object: ${path}`)
  }
  return value as Record<string, unknown>
}

function mergeJson(path: string, key: 'mcpServers' | 'servers', entry: unknown) {
  const parsed = readConfig(path)
  const current = parsed[key]
  const servers = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {}
  servers.synapse = entry
  parsed[key] = servers
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`)
}

function onDisk(file: string) {
  if (file.includes('app.asar.unpacked')) return file
  return file.replaceAll('app.asar', 'app.asar.unpacked')
}

export function mergeSynapseConfig(machine: Machine = thisMachine()) {
  const entry = {
    command: 'node',
    args: [onDisk(fileURLToPath(new URL('./mcp.ts', import.meta.url)))],
  }
  mergeJson(join(machine.home, '.cursor', 'mcp.json'), 'mcpServers', entry)
  const vscode = join(roaming(machine), 'Code', 'User', 'mcp.json')
  mergeJson(vscode, 'servers', entry)
  mergeJson(vscode, 'mcpServers', entry)
  const claude = join(machine.home, '.claude.json')
  mergeJson(claude, 'mcpServers', entry)
  mergeJson(join(machine.home, '.claude', 'settings.json'), 'mcpServers', entry)
}

function neo4jConfigured() {
  return Boolean(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD)
}

async function neo4j(statement: string, parameters: Record<string, unknown>) {
  const specifier = '../relay/neo4j.ts'
  const relay = (await import(specifier)) as {
    queryNeo4j: (statement: string, parameters: Record<string, unknown>) => Promise<unknown>
  }
  return relay.queryNeo4j(statement, parameters)
}

function cardText(card: SynapseCard) {
  return [card.title, card.solution, ...card.failure_modes, ...card.sources, ...card.relations.map((relation) => relation.target_entity)]
    .join('\n')
    .toLowerCase()
}

export async function searchTeamKnowledge(query: string, tags: string[] = [], directory = knowledgeDirectory()) {
  const needles = [query, ...tags].map((tag) => tag.toLowerCase()).filter(Boolean)
  if (neo4jConfigured()) {
    return neo4j(
      'MATCH (c:Card) WHERE toLower(c.title) CONTAINS $query OR toLower(c.solution) CONTAINS $query OR any(tag IN $tags WHERE toLower(c.title) CONTAINS tag OR toLower(c.solution) CONTAINS tag) RETURN c.id AS id, c.title AS title, c.solution AS solution, c.created_at AS created_at, c.source_type AS source_type LIMIT 20',
      { query: query.toLowerCase(), tags: tags.map((tag) => tag.toLowerCase()) },
    )
  }
  return readCards(directory)
    .filter((card) => {
      const text = cardText(card)
      return needles.length === 0 || needles.some((needle) => text.includes(needle))
    })
    .map((card) => ({
      id: card.id,
      title: card.title,
      solution: card.solution,
      created_at: card.created_at,
      source_type: card.sources[0] ?? '',
    }))
}

export async function entityRelations(entityName: string, directory = knowledgeDirectory()) {
  if (neo4jConfigured()) {
    return neo4j(
      'MATCH (a)-[r]->(b) WHERE a.name = $name OR a.username = $name OR a.email = $name OR a.title = $name OR a.id = $name OR b.name = $name OR b.title = $name OR b.id = $name RETURN type(r) AS relation, coalesce(a.name, a.username, a.title, a.id) AS entity, coalesce(b.name, b.title, b.id) AS target_entity LIMIT 50',
      { name: entityName },
    )
  }
  const name = entityName.toLowerCase()
  return readCards(directory).flatMap((card) => {
    const rows: { entity: string; relation: string; target_entity: string }[] = []
    const authorHit = card.author.username.toLowerCase() === name || card.author.email.toLowerCase() === name
    const cardHit = card.id.toLowerCase() === name || card.title.toLowerCase() === name
    if (authorHit || cardHit) {
      rows.push({ entity: card.author.username, relation: 'AUTHORED', target_entity: card.id })
    }
    for (const relation of card.relations) {
      if (authorHit || cardHit || relation.entity.toLowerCase() === name || relation.target_entity.toLowerCase() === name) {
        rows.push({ entity: relation.entity, relation: relation.relation, target_entity: relation.target_entity })
      }
    }
    return rows
  })
}

function toolResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

export async function handleMessage(message: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }) {
  if (message.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'synapse', version: '0.1.0' },
    }
  }
  if (message.method === 'tools/list') {
    return {
      tools: [
        {
          name: 'search_team_knowledge',
          description: 'Search team lesson cards by query and tags.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_entity_relations',
          description: 'List relations for a person, tool, issue, or card.',
          inputSchema: {
            type: 'object',
            properties: { entity_name: { type: 'string' } },
            required: ['entity_name'],
          },
        },
      ],
    }
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'search_team_knowledge') {
      const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
      return toolResult(await searchTeamKnowledge(typeof args.query === 'string' ? args.query : '', tags))
    }
    if (name === 'get_entity_relations') {
      return toolResult(await entityRelations(typeof args.entity_name === 'string' ? args.entity_name : ''))
    }
    return toolResult({ error: `Unknown tool ${name ?? ''}` })
  }
  return {}
}

async function serve() {
  const lines = createInterface({ input: process.stdin, terminal: false })
  for await (const line of lines) {
    if (line.trim() === '') continue
    const message = JSON.parse(line) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
    const result = await handleMessage(message)
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id ?? null, result })}\n`)
  }
}

const entry = process.argv[1] ?? ''
if (/(^|[\\/])mcp\.(ts|js|mjs)$/.test(entry) && import.meta.url === pathToFileURL(entry).href) {
  await serve()
}
