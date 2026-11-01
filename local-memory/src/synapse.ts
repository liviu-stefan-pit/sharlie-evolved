import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CardRelation = {
  entity: string
  relation: string
  target_entity: string
}

export type CardAuthor = {
  username: string
  email: string
  team: string
}

export type SynapseCard = {
  id: string
  title: string
  context: { os: string; tool_version: string; framework: string }
  solution: string
  failure_modes: string[]
  relations: CardRelation[]
  sources: string[]
  created_at: string
  author: CardAuthor
}

function yaml(value: string) {
  if (/[:#[\]{}&*!|>%`"'\n\r,]|^\s|\s$|^[-?]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return value
}

function cardStamp(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `card_${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
}

function takenIds(directory: string) {
  const taken = new Set<string>()
  for (const folder of ['inbox', 'cards', 'archive']) {
    const root = join(directory, folder)
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      const match = name.match(/(card_\d{8}_\d{6}(?:_\d+)?)(?:\.json|\.md)$/)
      if (match) taken.add(match[1])
    }
  }
  return taken
}

export function nextCardId(directory: string, now = new Date()) {
  const base = cardStamp(now)
  const taken = takenIds(directory)
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function claimsPath(directory: string) {
  return join(directory, 'cards', '.claims.json')
}

function readClaims(directory: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(claimsPath(directory), 'utf8')) as Record<string, unknown>
    const claims: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') claims[key] = value
    }
    return claims
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

function writeClaims(directory: string, claims: Record<string, string>) {
  mkdirSync(join(directory, 'cards'), { recursive: true })
  writeFileSync(claimsPath(directory), JSON.stringify(claims))
}

export function renderCardMarkdown(card: SynapseCard) {
  const modes = card.failure_modes.length > 0 ? card.failure_modes : ['']
  const relations = card.relations.length > 0 ? card.relations : []
  return [
    '---',
    `id: ${card.id}`,
    `title: ${yaml(card.title)}`,
    'context:',
    `  os: ${yaml(card.context.os)}`,
    `  tool_version: ${yaml(card.context.tool_version)}`,
    `  framework: ${yaml(card.context.framework)}`,
    `solution: ${yaml(card.solution)}`,
    'failure_modes:',
    ...modes.map((mode) => `  - ${yaml(mode)}`),
    ...(relations.length === 0
      ? ['relations: []']
      : [
          'relations:',
          ...relations.flatMap((relation) => [
            `  - entity: ${yaml(relation.entity)}`,
            `    relation: ${yaml(relation.relation)}`,
            `    target_entity: ${yaml(relation.target_entity)}`,
          ]),
        ]),
    'sources:',
    ...card.sources.map((source) => `  - ${yaml(source)}`),
    `created_at: ${card.created_at}`,
    'author:',
    `  username: ${yaml(card.author.username)}`,
    `  email: ${yaml(card.author.email)}`,
    `  team: ${yaml(card.author.team)}`,
    '---',
    '',
    '## Solution',
    '',
    card.solution,
    '',
    '## Failure modes',
    '',
    ...modes.flatMap((mode) => [mode, '']),
    '',
  ].join('\n')
}

function archivePrevious(directory: string, id: string) {
  const archive = join(directory, 'archive')
  mkdirSync(archive, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const ext of ['json', 'md'] as const) {
    const from = join(directory, 'cards', `${id}.${ext}`)
    if (!existsSync(from)) continue
    renameSync(from, join(archive, `${stamp}-${id}.${ext}`))
  }
}

function place(directory: string, name: string, body: string, drop: { enabled: boolean; drivePath: string; username: string }) {
  const inbox = join(directory, 'inbox')
  const cards = join(directory, 'cards')
  mkdirSync(inbox, { recursive: true })
  mkdirSync(cards, { recursive: true })
  const inboxFile = join(inbox, name)
  writeFileSync(inboxFile, body)
  if (drop.enabled && drop.drivePath.trim() !== '' && drop.username.trim() !== '') {
    const dest = join(drop.drivePath, 'Dropzone', drop.username)
    mkdirSync(dest, { recursive: true })
    copyFileSync(inboxFile, join(dest, name))
  }
  const target = join(cards, name)
  if (existsSync(target)) rmSync(target)
  renameSync(inboxFile, target)
}

export function publishCard(options: {
  directory: string
  legacyId: string
  card: Omit<SynapseCard, 'id' | 'created_at'> & { created_at?: string }
  autoDrop: boolean
  drivePath: string
  username: string
}) {
  const claims = readClaims(options.directory)
  const claimed = claims[options.legacyId]
  const existingId =
    claimed && readCard(options.directory, claimed)
      ? claimed
      : readCard(options.directory, options.legacyId)
        ? options.legacyId
        : null
  const existing = existingId ? readCard(options.directory, existingId) : null
  const id = existing?.id ?? nextCardId(options.directory)
  if (existing) archivePrevious(options.directory, id)
  const card: SynapseCard = {
    ...options.card,
    id,
    created_at: existing?.created_at ?? options.card.created_at ?? new Date().toISOString(),
  }
  const drop = { enabled: options.autoDrop, drivePath: options.drivePath, username: options.username }
  place(options.directory, `${id}.json`, `${JSON.stringify(card, null, 2)}\n`, drop)
  place(options.directory, `${id}.md`, renderCardMarkdown(card), drop)
  claims[options.legacyId] = id
  claims[id] = id
  writeClaims(options.directory, claims)
  return card
}

export function readCard(directory: string, id: string): SynapseCard | null {
  try {
    return JSON.parse(readFileSync(join(directory, 'cards', `${id}.json`), 'utf8')) as SynapseCard
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function readCards(directory: string): SynapseCard[] {
  const folder = join(directory, 'cards')
  if (!existsSync(folder)) return []
  const cards: SynapseCard[] = []
  for (const name of readdirSync(folder)) {
    if (!name.startsWith('card_') || !name.endsWith('.json')) continue
    try {
      cards.push(JSON.parse(readFileSync(join(folder, name), 'utf8')) as SynapseCard)
    } catch {
      continue
    }
  }
  return cards
}

export type GraphNode = {
  id: string
  kind: string
  label: string
  color: string
  synced?: boolean
  title?: string
  created_at?: string
  solution?: string
  failure_modes?: string[]
  relations?: CardRelation[]
}

export function localGraph(directory: string, drivePath = '', autoDrop = false) {
  const link = '#5c5c5c'
  const pending = '#b89a6a'
  const syncedColor = '#6f8f78'
  const neutral = '#9d9d9d'
  const nodes = new Map<string, GraphNode>()
  const links: { source: string; target: string }[] = []
  function ensure(kind: string, key: string, label: string) {
    const id = `${kind}:${key}`
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, color: neutral })
    return id
  }
  for (const card of readCards(directory)) {
    const copied =
      drivePath.trim() !== '' &&
      existsSync(join(drivePath, 'Dropzone', card.author.username, `${card.id}.json`))
    void autoDrop
    const cardId = ensure('card', card.id, card.title)
    const node = nodes.get(cardId)!
    node.synced = copied
    node.color = copied ? syncedColor : pending
    node.title = card.title
    node.created_at = card.created_at
    node.solution = card.solution
    node.failure_modes = card.failure_modes
    node.relations = card.relations
    const author = ensure('developer', card.author.email || card.author.username, card.author.username)
    links.push({ source: author, target: cardId })
    for (const relation of card.relations) {
      const kind =
        relation.relation === 'APPLIES_TO' || relation.relation === 'OCCURS_IN' || relation.relation === 'INCOMPATIBLE_WITH'
          ? 'tool'
          : relation.relation === 'WARNS_AGAINST'
            ? 'antipattern'
            : 'issue'
      const target = ensure(kind, relation.target_entity, relation.target_entity)
      links.push({ source: cardId, target })
    }
    for (const source of card.sources) {
      const tool = ensure('tool', source, source)
      if (!links.some((link) => link.source === cardId && link.target === tool)) {
        links.push({ source: cardId, target: tool })
      }
    }
  }
  return {
    canvas: '#1f1f1f',
    panel: '#252526',
    border: '#3c3c3c',
    text: '#cccccc',
    muted: '#9d9d9d',
    accent: link,
    synced: syncedColor,
    pending,
    nodes: [...nodes.values()],
    links,
  }
}
