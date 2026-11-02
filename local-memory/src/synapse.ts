import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isFileMention, isLearningSource } from './graph-rules.ts'
import type { KbNode } from './kb.ts'

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
  topics: string[]
  context: { os: string; tool_version: string; framework: string }
  solution: string
  failure_modes: string[]
  relations: CardRelation[]
  sources: string[]
  created_at: string
  author: CardAuthor
  /** Missing, or any value other than work, means the card stays on this PC. */
  scope?: 'work' | 'personal'
  /**
   * Stamped once, at the moment the card is first learned.
   * True only when sharing was on, a team folder was set, and the lesson was work.
   * Missing means the lesson is not shared, including after sharing is turned on later.
   */
  shareEligible?: boolean
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

function topicLines(topics: string[]) {
  if (topics.length === 0) return ['topics: []']
  return ['topics:', ...topics.map((topic) => `  - ${yaml(topic)}`)]
}

function withTopics(card: SynapseCard): SynapseCard {
  const topics = (card as { topics?: unknown }).topics
  return {
    ...card,
    topics: Array.isArray(topics) ? topics.filter((topic): topic is string => typeof topic === 'string') : [],
  }
}

export function renderCardMarkdown(card: SynapseCard) {
  const modes = card.failure_modes.length > 0 ? card.failure_modes : ['']
  const relations = card.relations.length > 0 ? card.relations : []
  const topics = card.topics ?? []
  return [
    '---',
    `id: ${card.id}`,
    ...(card.scope === 'work' || card.scope === 'personal' ? [`scope: ${card.scope}`] : []),
    `title: ${yaml(card.title)}`,
    ...topicLines(topics),
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

function place(directory: string, name: string, body: string) {
  const inbox = join(directory, 'inbox')
  const cards = join(directory, 'cards')
  mkdirSync(inbox, { recursive: true })
  mkdirSync(cards, { recursive: true })
  const inboxFile = join(inbox, name)
  writeFileSync(inboxFile, body)
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
    topics: options.card.topics ?? [],
    id,
    created_at: existing?.created_at ?? options.card.created_at ?? new Date().toISOString(),
  }
  if (existing?.shareEligible === true) card.shareEligible = true
  else if (!existing && options.card.shareEligible === true) card.shareEligible = true
  else delete card.shareEligible
  place(options.directory, `${id}.json`, `${JSON.stringify(card, null, 2)}\n`)
  place(options.directory, `${id}.md`, renderCardMarkdown(card))
  claims[options.legacyId] = id
  claims[id] = id
  writeClaims(options.directory, claims)
  return card
}

export function readCard(directory: string, id: string): SynapseCard | null {
  try {
    return withTopics(JSON.parse(readFileSync(join(directory, 'cards', `${id}.json`), 'utf8')) as SynapseCard)
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
      cards.push(withTopics(JSON.parse(readFileSync(join(folder, name), 'utf8')) as SynapseCard))
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
  degree?: number
  synced?: boolean
  scope?: 'work' | 'personal'
  title?: string
  created_at?: string
  solution?: string
  failure_modes?: string[]
  relations?: CardRelation[]
  shareState?: 'shared' | 'waiting' | 'local'
  writer?: string
}

export type TeamShare = {
  sharing: boolean
  owned: Readonly<Record<string, string>>
  remote: readonly KbNode[]
}

export function localGraph(directory: string, share: TeamShare = { sharing: false, owned: {}, remote: [] }) {
  const link = '#5c5c5c'
  const pending = '#b89a6a'
  const syncedColor = '#6f8f78'
  const neutral = '#9d9d9d'
  const nodes = new Map<string, GraphNode>()
  const links: { source: string; target: string }[] = []
  const neighbors = new Map<string, Set<string>>()
  function ensure(kind: string, key: string, label: string) {
    const id = `${kind}:${key}`
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, color: neutral, degree: 0 })
    return id
  }
  function touch(from: string, to: string) {
    let set = neighbors.get(from)
    if (!set) {
      set = new Set()
      neighbors.set(from, set)
    }
    set.add(to)
  }
  function connect(source: string, target: string) {
    if (source === target) return
    if (neighbors.get(source)?.has(target)) return
    touch(source, target)
    touch(target, source)
    links.push({ source, target })
  }
  function projectName(value: string | undefined) {
    const name = (value ?? '').trim()
    if (name === '' || name === 'none' || isFileMention(name)) return ''
    return name
  }
  const ownedIds = new Set(Object.values(share.owned))
  for (const card of readCards(directory)) {
    const kbId = share.owned[card.id]
    const copied = typeof kbId === 'string' && kbId !== '' && share.remote.some((node) => node.id === kbId)
    const shareState = copied
      ? 'shared'
      : card.shareEligible === true && card.scope === 'work' && share.sharing
        ? 'waiting'
        : 'local'
    const cardId = ensure('card', card.id, card.title)
    const node = nodes.get(cardId)!
    node.synced = copied
    node.shareState = shareState
    node.writer = card.author.username
    if (card.scope === 'work' || card.scope === 'personal') node.scope = card.scope
    node.color = copied ? syncedColor : pending
    node.title = card.title
    node.created_at = card.created_at
    node.solution = card.solution
    node.failure_modes = card.failure_modes
    const author = ensure('developer', card.author.email || card.author.username, card.author.username)
    connect(author, cardId)
    const team = (card.author.team ?? '').trim()
    if (team !== '' && !isFileMention(team)) connect(ensure('team', team, team), cardId)
    for (const topic of card.topics) {
      const name = topic.trim()
      if (name === '' || isFileMention(name)) continue
      connect(cardId, ensure('topic', name, name))
    }
    for (const source of card.sources) {
      const name = source.trim()
      if (!isLearningSource(name)) continue
      connect(cardId, ensure('tool', name, name))
    }
    const framework = projectName(card.context?.framework)
    if (framework !== '') connect(cardId, ensure('issue', framework, framework))
  }
  for (const lesson of share.remote) {
    if (ownedIds.has(lesson.id)) continue
    const cardId = ensure('card', lesson.id, lesson.title)
    const node = nodes.get(cardId)!
    node.synced = true
    node.shareState = 'shared'
    node.scope = 'work'
    node.color = syncedColor
    node.title = lesson.title
    node.created_at = lesson.created_at
    node.solution = lesson.whatToDo
    node.failure_modes = [lesson.situation, lesson.why, lesson.apply].filter((mode) => mode !== '')
    node.writer = lesson.author.username.trim() || lesson.writer
    const author = ensure('developer', lesson.author.email || lesson.author.username || lesson.writer, lesson.author.username || lesson.writer)
    connect(author, cardId)
    const team = lesson.author.team.trim()
    if (team !== '' && !isFileMention(team)) connect(ensure('team', team, team), cardId)
    for (const topic of lesson.topics) {
      const name = topic.trim()
      if (name === '' || isFileMention(name)) continue
      connect(cardId, ensure('topic', name, name))
    }
    for (const source of lesson.sources) {
      const name = source.trim()
      if (!isLearningSource(name)) continue
      connect(cardId, ensure('tool', name, name))
    }
    const framework = projectName(lesson.project)
    if (framework !== '') connect(cardId, ensure('issue', framework, framework))
  }
  for (const node of nodes.values()) {
    node.degree = neighbors.get(node.id)?.size ?? 0
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
