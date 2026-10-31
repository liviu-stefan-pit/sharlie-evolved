import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteSecret, deleteVault, readSecret, writeSecret } from './vault.ts'

export type Profile = {
  username: string
  email: string
  team: string
}

export type Transcript = {
  id?: string
  source: string
  text: string
  repo?: string
  workspace?: string
  changedAt?: string
}

export type KnownCard = {
  id: string
  sources: string[]
  title: string
  topics: string[]
  summary: string
  situation: string
  whatToDo: string
  why: string
  apply: string
}

export type LessonDraft = {
  scope: 'personal' | 'work'
  title: string
  topics: string[]
  summary: string
  situation: string
  whatToDo: string
  why: string
  apply: string
  otherNames: string[]
  belongsToProject: string | null
  clearlyOneProduct: boolean
  subjectProject: string | null
  generalTechnique: boolean
  sources?: string[]
  sameClaim?: boolean
  updateId?: string
}

export type CompleteLesson = (request: {
  model: string
  transcript: Transcript
  transcripts: Transcript[]
  projects: string[]
  cards: KnownCard[]
}) => LessonDraft

export type LookupTurn =
  | {
      model: string
      question: string
      catalog: { file: string; summary: string }[]
    }
  | {
      model: string
      question: string
      cards: { file: string; text: string }[]
    }

export type ModelRequest = {
  provider: Provider
  secret: string
  model: string
  prompt: string
}

export type ModelExchange = (request: ModelRequest) => string | Promise<string>

export type AnswerLookup = (
  turn: LookupTurn,
) =>
  | { pick: string[] }
  | { answer: string }
  | Promise<{ pick: string[] } | { answer: string }>

export type Provider = 'cursor' | 'copilot' | 'anthropic' | 'openai'

export type ListedModel = {
  id: string
  displayName: string
}

export type CursorAccount = {
  models: ListedModel[]
  createdAt?: string
  expiresAt?: string
  error?: string
}

export type CursorLookup = (secret: string) => Promise<CursorAccount>

export type ToolId = 'cursor' | 'copilot' | 'claude' | 'cursor-cli' | 'claude-cli' | 'copilot-cli'

export type Machine = {
  platform: 'win32' | 'darwin'
  home: string
  localAppData: string
  path: string
  pathExt: string
  applications: string
  claudeProtocol: boolean
}

export type InstalledTool = {
  id: ToolId
  label: string
  enabled: boolean
}

export type SavedKey = {
  id: string
  provider: Provider
  active: boolean
}

type Settings = {
  profile: Profile
  vaultId: string
  keys: SavedKey[]
  pinnedKeyId: string
  model: string
  learnerIntervalMs: number
  publisherIntervalMs: number
  drivePath: string
  disabledTools: string[]
  learningStarted: boolean
  importedTranscripts: Record<string, string>
  cursorModels: ListedModel[]
  cursorKey: { createdAt: string; expiresAt: string; error: string }
  selectedProvider: Provider | ''
}

const emptyProfile = (): Profile => ({ username: '', email: '', team: '' })

const hourMs = 60 * 60 * 1000
const importBatchSize = 10

function requireAtLeastOneHour(intervalMs: number, job: string) {
  if (intervalMs < hourMs) throw new Error(`${job} interval must be at least one hour`)
}

const keyOrder: Record<Provider, number> = {
  cursor: 0,
  copilot: 1,
  anthropic: 2,
  openai: 3,
}

const modelCatalog: Record<Provider, { models: string[]; defaultModel: string }> = {
  cursor: { models: [], defaultModel: '' },
  copilot: { models: [], defaultModel: '' },
  anthropic: {
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-5-5',
  },
  openai: {
    models: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
    defaultModel: 'gpt-6-luna',
  },
}

function providerName(value: unknown): Provider | '' {
  return value === 'cursor' || value === 'copilot' || value === 'anthropic' || value === 'openai' ? value : ''
}

function cursorExpiry(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value
    return new Date(ms).toISOString()
  }
  if (typeof value === 'string' && value !== '') {
    if (/^\d+$/.test(value)) {
      const parsed = Number(value)
      const ms = parsed < 1e12 ? parsed * 1000 : parsed
      return new Date(ms).toISOString()
    }
    return value
  }
  return ''
}

function cursorKeyInfo(value: unknown): { createdAt: string; expiresAt: string; error: string } {
  const record = value && typeof value === 'object' ? (value as { createdAt?: unknown; expiresAt?: unknown; error?: unknown }) : {}
  const text = (item: unknown) => (typeof item === 'string' ? item : '')
  return { createdAt: text(record.createdAt), expiresAt: text(record.expiresAt), error: text(record.error) }
}

function listedModels(value: unknown): ListedModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { id?: unknown; displayName?: unknown }
    if (typeof record.id !== 'string' || record.id === '') return []
    const displayName = typeof record.displayName === 'string' && record.displayName !== '' ? record.displayName : record.id
    return [{ id: record.id, displayName }]
  })
}

export async function lookupCursorAccount(secret: string, fetchImpl: typeof fetch = fetch): Promise<CursorAccount> {
  const headers = { authorization: `Bearer ${secret}`, accept: 'application/json' }
  let models: ListedModel[] = []
  let error = ''
  try {
    const response = await fetchImpl('https://api.cursor.com/v1/models', { headers })
    if (!response.ok) throw new Error(`Cursor models ${response.status}`)
    const body = (await response.json()) as { items?: { id?: string; displayName?: string }[] }
    models = (body.items ?? [])
      .filter((item): item is { id: string; displayName?: string } => typeof item?.id === 'string' && item.id !== '')
      .map((item) => ({ id: item.id, displayName: item.displayName || item.id }))
    if (models.length === 0) throw new Error('Cursor returned no models')
  } catch {
    try {
      const response = await fetchImpl('https://api.cursor.com/v0/models', { headers })
      if (!response.ok) throw new Error(`Cursor models ${response.status}`)
      const body = (await response.json()) as { models?: unknown }
      const ids = Array.isArray(body.models) ? body.models.filter((id): id is string => typeof id === 'string' && id !== '') : []
      models = ids.map((id) => ({ id, displayName: id }))
      if (models.length === 0) throw new Error('Cursor returned no models')
    } catch (fallback) {
      error = fallback instanceof Error ? fallback.message : 'Cursor model list failed'
    }
  }
  let createdAt = ''
  let expiresAt = ''
  try {
    const response = await fetchImpl('https://api.cursor.com/v1/me', { headers })
    if (response.ok) {
      const body = (await response.json()) as {
        createdAt?: unknown
        expiresAt?: unknown
        apiKeyExpiresAt?: unknown
        apiKeyExpiresAtMs?: unknown
      }
      createdAt = typeof body.createdAt === 'string' ? body.createdAt : ''
      expiresAt = cursorExpiry(body.apiKeyExpiresAtMs ?? body.apiKeyExpiresAt ?? body.expiresAt)
    }
  } catch {
    // A key is still saved when the account call fails.
  }
  if (expiresAt === '') {
    try {
      expiresAt = await listedCursorKeyExpiry(secret, fetchImpl)
    } catch {
      expiresAt = ''
    }
  }
  return { models, createdAt, expiresAt, error }
}

async function listedCursorKeyExpiry(secret: string, fetchImpl: typeof fetch) {
  const exchange = await fetchImpl('https://api2.cursor.sh/auth/exchange_user_api_key', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: '{}',
  })
  if (!exchange.ok) return ''
  const session = (await exchange.json()) as { accessToken?: unknown }
  if (typeof session.accessToken !== 'string' || session.accessToken === '') return ''
  const listed = await fetchImpl('https://api2.cursor.sh/aiserver.v1.DashboardService/ListUserApiKeys', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
      'connect-protocol-version': '1',
    },
    body: '{}',
  })
  if (!listed.ok) return ''
  const body = (await listed.json()) as { apiKeys?: unknown }
  if (!Array.isArray(body.apiKeys)) return ''
  const suffix = secret.slice(-4)
  const match = body.apiKeys.find((item) => {
    if (!item || typeof item !== 'object') return false
    const masked = (item as { maskedKey?: unknown }).maskedKey
    return typeof masked === 'string' && masked.endsWith(suffix)
  }) as { expiresAt?: unknown; expiry?: unknown; expiresAtMs?: unknown; apiKeyExpiresAtMs?: unknown } | undefined
  if (!match) return ''
  return cursorExpiry(match.expiresAt ?? match.expiry ?? match.expiresAtMs ?? match.apiKeyExpiresAtMs)
}

function settingsPath(directory: string) {
  return join(directory, 'settings.json')
}

function emptySettings(): Settings {
  return {
    profile: emptyProfile(),
    vaultId: '',
    keys: [],
    pinnedKeyId: '',
    model: '',
    learnerIntervalMs: hourMs,
    publisherIntervalMs: hourMs,
    drivePath: '',
    disabledTools: [],
    learningStarted: false,
    importedTranscripts: {},
    cursorModels: [],
    cursorKey: { createdAt: '', expiresAt: '', error: '' },
    selectedProvider: '',
  }
}

function readSettings(directory: string): Settings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(directory), 'utf8')) as Settings
    const defaults = emptySettings()
    return {
      profile: { ...defaults.profile, ...parsed.profile },
      vaultId: parsed.vaultId ?? defaults.vaultId,
      keys: parsed.keys ?? defaults.keys,
      pinnedKeyId: parsed.pinnedKeyId ?? defaults.pinnedKeyId,
      model: parsed.model ?? defaults.model,
      learnerIntervalMs: parsed.learnerIntervalMs ?? defaults.learnerIntervalMs,
      publisherIntervalMs: parsed.publisherIntervalMs ?? defaults.publisherIntervalMs,
      drivePath: parsed.drivePath ?? defaults.drivePath,
      disabledTools: parsed.disabledTools ?? defaults.disabledTools,
      learningStarted: parsed.learningStarted ?? defaults.learningStarted,
      importedTranscripts: parsed.importedTranscripts ?? defaults.importedTranscripts,
      cursorModels: listedModels(parsed.cursorModels),
      cursorKey: cursorKeyInfo(parsed.cursorKey),
      selectedProvider: providerName(parsed.selectedProvider),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySettings()
    throw error
  }
}

function writeSettings(directory: string, settings: Settings) {
  const current = readSettings(directory)
  const merged: Settings = {
    ...settings,
    importedTranscripts: { ...current.importedTranscripts, ...settings.importedTranscripts },
  }
  mkdirSync(directory, { recursive: true })
  writeFileSync(settingsPath(directory), JSON.stringify(merged))
}

export function discardVault(directory: string) {
  const { vaultId } = readSettings(directory)
  if (vaultId) deleteVault(vaultId)
}

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function filled(value: string) {
  return value.trim() !== ''
}

function sentenceCount(text: string) {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function lessonIsComplete(lesson: LessonDraft, source: string) {
  return (
    (lesson.scope === 'personal' || lesson.scope === 'work') &&
    filled(source) &&
    filled(lesson.title) &&
    lesson.topics.length > 0 &&
    lesson.topics.every(filled) &&
    filled(lesson.summary) &&
    sentenceCount(lesson.summary) >= 1 &&
    sentenceCount(lesson.summary) <= 2 &&
    filled(lesson.situation) &&
    filled(lesson.whatToDo) &&
    filled(lesson.why) &&
    filled(lesson.apply) &&
    [lesson.situation, lesson.whatToDo, lesson.why, lesson.apply].every(
      (part) => wordCount(part) <= 120,
    )
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactSecrets(text: string) {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(
      /\b(password|passwd|pwd|token|api[_-]?key|secret)\b(\s*[:=]\s*)(['"]?)[^\s'"]+\3/gi,
      '$1$2[redacted]',
    )
}

function termPattern(term: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, 'giu')
}

function scrubText(text: string, names: string[], keep: string[]) {
  const codes: string[] = []
  let value = text.replace(/`[^`\n]+`/g, (span) => {
    codes.push(span)
    return `\u0001${codes.length - 1}\u0001`
  })
  const holds = keep
    .filter(filled)
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((term, index) => ({ term, token: `\u0000${index}\u0000` }))
  for (const hold of holds) value = value.replace(termPattern(hold.term), hold.token)
  const kept = new Set(keep.filter(filled).map((term) => term.toLowerCase()))
  for (const name of names.filter(filled).sort((left, right) => right.length - left.length)) {
    if (kept.has(name.toLowerCase())) continue
    value = value.replace(termPattern(name), '')
  }
  value = value.replace(/\u0001(\d+)\u0001/g, (_match, index: string) => codes[Number(index)] ?? '')
  value = redactSecrets(value)
  for (const hold of holds) value = value.replaceAll(hold.token, hold.term)
  return value
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .trim()
}

function yaml(value: string) {
  if (/[:#[\]{}&*!|>%`"'\n\r,]|^\s|\s$|^[-?]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return value
}

function knowledgeProjects(directory: string) {
  const found: string[] = []
  function walk(folder: string) {
    if (!existsSync(folder)) return
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      const project = readFileSync(path, 'utf8').match(/^project: "?([^"\n]+)"?$/m)?.[1]
      if (project && project !== 'none' && !found.includes(project)) found.push(project)
    }
  }
  walk(join(directory, 'personal'))
  walk(join(directory, 'work'))
  return found
}

function unyaml(value: string) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return trimmed
}

function frontField(front: string, name: string) {
  return unyaml(front.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1] ?? '')
}

function frontList(front: string, name: string) {
  const lines = front.split('\n')
  const start = lines.findIndex((line) => line === `${name}:`)
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  - ')) break
    items.push(unyaml(line.slice(4)))
  }
  return items
}

function lessonSection(body: string, heading: string) {
  const marker = `## ${heading}\n\n`
  const start = body.indexOf(marker)
  if (start === -1) return ''
  const rest = body.slice(start + marker.length)
  const next = rest.search(/\n## /)
  return (next === -1 ? rest : rest.slice(0, next)).trim()
}

type GraphKind = 'person' | 'team' | 'project' | 'source' | 'topic' | 'card'

type StoredCard = KnownCard & {
  path: string
  at: string
  author: Profile
  scope: 'personal' | 'work'
  project: string
}

function authorField(front: string, name: string) {
  return unyaml(front.match(new RegExp(`^  ${name}: (.*)$`, 'm'))?.[1] ?? '')
}

function parseCard(text: string, path: string): StoredCard | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null
  const front = match[1]
  const body = match[2]
  const id = frontField(front, 'id')
  if (!id) return null
  const scope = frontField(front, 'scope')
  return {
    path,
    id,
    at: frontField(front, 'at'),
    author: {
      username: authorField(front, 'username'),
      email: authorField(front, 'email'),
      team: authorField(front, 'team'),
    },
    scope: scope === 'personal' ? 'personal' : 'work',
    sources: frontList(front, 'sources'),
    project: frontField(front, 'project'),
    title: frontField(front, 'title'),
    topics: frontList(front, 'topics'),
    summary: frontField(front, 'summary'),
    situation: lessonSection(body, 'Situation'),
    whatToDo: lessonSection(body, 'What to do'),
    why: lessonSection(body, 'Why'),
    apply: lessonSection(body, 'How someone who was not in the chat applies it'),
  }
}

function readStoredCards(directory: string) {
  const found: StoredCard[] = []
  function walk(folder: string) {
    if (!existsSync(folder)) return
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      const card = parseCard(readFileSync(path, 'utf8'), path)
      if (card) found.push(card)
    }
  }
  walk(join(directory, 'personal'))
  walk(join(directory, 'work'))
  return found
}

function transcriptKey(transcript: Transcript) {
  if (transcript.id) return transcript.id
  return createHash('sha256')
    .update(`${transcript.source}\0${transcript.text}\0${transcript.repo ?? ''}\0${transcript.workspace ?? ''}`)
    .digest('hex')
}

function transcriptRevision(transcript: Transcript) {
  return createHash('sha256')
    .update(`${transcript.changedAt ?? ''}\0${transcript.text}`)
    .digest('hex')
}

function newestFirst(transcripts: Transcript[]) {
  return transcripts
    .map((transcript, index) => ({ transcript, index }))
    .sort((left, right) => {
      const leftAt = Date.parse(left.transcript.changedAt ?? '')
      const rightAt = Date.parse(right.transcript.changedAt ?? '')
      const leftDated = !Number.isNaN(leftAt)
      const rightDated = !Number.isNaN(rightAt)
      if (leftDated && rightDated && leftAt !== rightAt) return rightAt - leftAt
      if (leftDated !== rightDated) return leftDated ? -1 : 1
      return left.index - right.index
    })
    .map(({ transcript }) => transcript)
}

function knownProject(name: string | null, projects: string[]) {
  if (!name) return null
  return projects.find((project) => project.toLowerCase() === name.toLowerCase()) ?? null
}

function cardIsSynced(directory: string, drivePath: string, card: StoredCard) {
  if (card.scope !== 'work' || drivePath.trim() === '') return false
  const rel = relative(join(directory, 'work'), card.path)
  if (rel.startsWith('..')) return false
  const copy = join(drivePath, rel)
  if (!existsSync(copy)) return false
  return readFileSync(card.path).equals(readFileSync(copy))
}

function copyWorkTree(source: string, dest: string) {
  if (!existsSync(source)) return
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyWorkTree(from, to)
      continue
    }
    if (!entry.isFile()) continue
    mkdirSync(dest, { recursive: true })
    copyFileSync(from, to)
  }
}

function slug(title: string) {
  const value = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  return value || 'lesson'
}

function renderCard(card: {
  id: string
  at: string
  author: Profile
  scope: 'personal' | 'work'
  sources: string[]
  project: string
  title: string
  topics: string[]
  summary: string
  situation: string
  whatToDo: string
  why: string
  apply: string
}) {
  return [
    '---',
    `id: ${card.id}`,
    `at: ${card.at}`,
    'author:',
    `  username: ${yaml(card.author.username)}`,
    `  email: ${yaml(card.author.email)}`,
    `  team: ${yaml(card.author.team)}`,
    `scope: ${card.scope}`,
    'sources:',
    ...card.sources.map((source) => `  - ${yaml(source)}`),
    `project: ${yaml(card.project)}`,
    `title: ${yaml(card.title)}`,
    'topics:',
    ...card.topics.map((topic) => `  - ${yaml(topic)}`),
    `summary: ${yaml(card.summary)}`,
    '---',
    '',
    '## Situation',
    '',
    card.situation,
    '',
    '## What to do',
    '',
    card.whatToDo,
    '',
    '## Why',
    '',
    card.why,
    '',
    '## How someone who was not in the chat applies it',
    '',
    card.apply,
    '',
  ].join('\n')
}

function isFile(path: string) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function commandOnPath(machine: Machine, name: string) {
  const delimiter = machine.platform === 'win32' ? ';' : ':'
  const extensions =
    machine.platform === 'win32' ? ['', ...machine.pathExt.split(';').filter(Boolean)] : ['']
  for (const dir of machine.path.split(delimiter)) {
    if (!dir) continue
    for (const extension of extensions) {
      if (isFile(join(dir, extension ? name + extension.toLowerCase() : name))) return true
    }
  }
  return false
}

function cursorInstalled(machine: Machine) {
  if (machine.platform === 'win32') {
    return isFile(join(machine.localAppData, 'Programs', 'cursor', 'Cursor.exe'))
  }
  return (
    isDirectory(join(machine.applications, 'Cursor.app')) ||
    isDirectory(join(machine.home, 'Applications', 'Cursor.app'))
  )
}

function copilotInVsCode(machine: Machine) {
  const extensions = join(machine.home, '.vscode', 'extensions')
  if (!isDirectory(extensions)) return false
  return readdirSync(extensions).some(
    (name) => name.startsWith('github.copilot-') && isDirectory(join(extensions, name)),
  )
}

function claudeInstalled(machine: Machine) {
  if (machine.platform === 'win32') {
    if (machine.claudeProtocol) return true
    const root = join(machine.localAppData, 'AnthropicClaude')
    if (isFile(join(root, 'claude.exe'))) return true
    if (!isDirectory(root)) return false
    return readdirSync(root).some(
      (name) => name.startsWith('app-') && isFile(join(root, name, 'claude.exe')),
    )
  }
  return (
    isDirectory(join(machine.applications, 'Claude.app')) ||
    isDirectory(join(machine.home, 'Applications', 'Claude.app'))
  )
}

function cursorCliInstalled(machine: Machine) {
  if (commandOnPath(machine, 'cursor-agent')) return true
  if (machine.platform === 'win32') {
    const root = join(machine.localAppData, 'cursor-agent')
    return ['agent.cmd', 'agent.exe', 'cursor-agent.cmd', 'cursor-agent.exe'].some((name) =>
      isFile(join(root, name)),
    )
  }
  const bin = join(machine.home, '.local', 'bin')
  return isFile(join(bin, 'agent')) || isFile(join(bin, 'cursor-agent'))
}

function namedCli(machine: Machine, name: string) {
  if (commandOnPath(machine, name)) return true
  const bin = join(machine.home, '.local', 'bin')
  if (machine.platform === 'win32') {
    return isFile(join(bin, `${name}.exe`)) || isFile(join(bin, `${name}.cmd`))
  }
  return isFile(join(bin, name))
}

function claudeProtocolRegistered() {
  if (process.platform !== 'win32') return false
  for (const key of ['HKCU\\Software\\Classes\\claude', 'HKCR\\claude']) {
    try {
      execFileSync('reg', ['query', key, '/ve'], { stdio: 'ignore' })
      return true
    } catch {
      continue
    }
  }
  return false
}

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
    claudeProtocol: claudeProtocolRegistered(),
  }
}

const knownTools: { id: ToolId; label: string; installed: (machine: Machine) => boolean }[] = [
  { id: 'cursor', label: 'Cursor', installed: cursorInstalled },
  { id: 'copilot', label: 'Copilot in VS Code', installed: copilotInVsCode },
  { id: 'claude', label: 'Claude', installed: claudeInstalled },
  { id: 'cursor-cli', label: 'Cursor CLI', installed: cursorCliInstalled },
  { id: 'claude-cli', label: 'Claude CLI', installed: (machine) => namedCli(machine, 'claude') },
  { id: 'copilot-cli', label: 'Copilot CLI', installed: (machine) => namedCli(machine, 'copilot') },
]

function scanTools(machine: Machine) {
  return knownTools
    .filter((tool) => tool.installed(machine))
    .map((tool) => ({ id: tool.id, label: tool.label }))
}

function jsonlFiles(root: string) {
  if (!isDirectory(root)) return []
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) continue
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  return found
}

function flattenText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part.trim()
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text.trim()
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function lineText(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const record = value as { role?: unknown; type?: unknown; message?: unknown; content?: unknown }
  const role = typeof record.role === 'string' ? record.role : typeof record.type === 'string' ? record.type : ''
  if (role !== 'user' && role !== 'assistant') return ''
  const message = record.message
  const content =
    message && typeof message === 'object' && 'content' in message
      ? (message as { content?: unknown }).content
      : record.content
  return flattenText(content)
}

function transcriptFromFile(file: string, source: string, root: string): Transcript | null {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const parts: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const text = lineText(JSON.parse(line) as unknown)
      if (text) parts.push(text)
    } catch {
      continue
    }
  }
  if (parts.length === 0) return null
  const slug = relative(root, file).split(/[/\\]/)[0]
  return {
    id: file,
    source,
    text: parts.join('\n'),
    repo: slug || undefined,
    changedAt: statSync(file).mtime.toISOString(),
  }
}

export function readInstalledTranscripts(machine: Machine = thisMachine()): Transcript[] {
  const installed = new Set(scanTools(machine).map((tool) => tool.id))
  const seen = new Set<string>()
  const transcripts: Transcript[] = []
  function take(files: string[], source: string, root: string) {
    for (const file of files) {
      if (seen.has(file)) continue
      seen.add(file)
      const transcript = transcriptFromFile(file, source, root)
      if (transcript) transcripts.push(transcript)
    }
  }
  const projects = join(machine.home, '.cursor', 'projects')
  const agentTranscripts = (files: string[]) =>
    files.filter((file) => file.split(/[/\\]/).includes('agent-transcripts'))
  if (installed.has('cursor')) take(agentTranscripts(jsonlFiles(projects)), 'cursor', projects)
  if (installed.has('cursor-cli')) {
    const chats = join(machine.home, '.cursor', 'chats')
    take(jsonlFiles(chats), 'cursor-cli', chats)
    take(agentTranscripts(jsonlFiles(projects)), 'cursor-cli', projects)
  }
  if (installed.has('claude-cli')) {
    const claude = join(machine.home, '.claude', 'projects')
    take(jsonlFiles(claude), 'claude-cli', claude)
  }
  return transcripts
}

function cardFile(directory: string, path: string) {
  return relative(directory, path).split('\\').join('/')
}

function discoverySkill(knowledge: string, model: string) {
  const lookupCli = fileURLToPath(new URL('./lookup-cli.ts', import.meta.url))
  return [
    '---',
    'name: local-knowledge',
    'description: Look up a lesson in the local knowledge. Use when the person asks the local knowledge a question.',
    '---',
    '',
    '# Local knowledge',
    '',
    `The local knowledge on this machine is \`${knowledge}\`.`,
    '',
    `The model that answers a lookup is \`${model}\`.`,
    '',
    `Ask by running \`node "${lookupCli}" "${knowledge}"\` followed by the question as one argument.`,
    "Use that command's output as the answer.",
    '',
    'This chat uses the model selected in the IDE.',
    '',
  ].join('\n')
}

function renderLookup(turn: LookupTurn) {
  if ('catalog' in turn) {
    return [
      `Question: ${turn.question}`,
      '',
      'Catalog:',
      ...turn.catalog.flatMap((card) => [card.file, card.summary, '']),
      'Reply with JSON {"pick":["file"]}.',
    ].join('\n')
  }
  return [
    `Question: ${turn.question}`,
    '',
    'Cards:',
    ...turn.cards.flatMap((card) => [card.file, card.text, '']),
    'Reply with JSON {"answer":"..."}.',
  ].join('\n')
}

export async function ask(
  directory: string,
  question: string,
  exchange: ModelExchange,
  machine?: Machine,
) {
  const key = openApp(directory, undefined, machine).activeKey()
  const app = openApp(directory, undefined, machine, async (turn) => {
    const text = await exchange({
      provider: key.provider,
      secret: key.secret,
      model: turn.model,
      prompt: renderLookup(turn),
    })
    return JSON.parse(text) as { pick: string[] } | { answer: string }
  })
  const result = await app.lookup(question)
  return result.answer
}

function writeDiscoverySkills(machine: Machine, knowledge: string, model: string) {
  const text = discoverySkill(knowledge, model)
  for (const tool of ['.cursor', '.claude']) {
    const folder = join(machine.home, tool, 'skills', 'local-knowledge')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'SKILL.md'), text)
  }
}

export function openApp(
  directory: string,
  complete?: CompleteLesson,
  machine: Machine = thisMachine(),
  answer?: AnswerLookup,
  cursorLookup: CursorLookup = lookupCursorAccount,
) {
  const settings = readSettings(directory)
  function modelChoices(provider: Provider): ListedModel[] {
    if (provider === 'cursor') return settings.cursorModels
    return modelCatalog[provider].models.map((id) => ({ id, displayName: id }))
  }
  function chosenKey() {
    if (settings.selectedProvider) {
      const matches = settings.keys.filter((key) => key.provider === settings.selectedProvider)
      if (matches.length === 0) return undefined
      return matches.find((key) => key.id === settings.pinnedKeyId) ?? matches[matches.length - 1]
    }
    const pinned = settings.keys.find((key) => key.id === settings.pinnedKeyId)
    if (pinned) return pinned
    if (settings.keys.length === 0) return undefined
    return settings.keys.reduce((best, key) => (keyOrder[key.provider] < keyOrder[best.provider] ? key : best))
  }
  function offeredModels() {
    const active = settings.keys.find((key) => key.active)
    return active ? modelChoices(active.provider).map((model) => model.id) : []
  }
  function profileIsComplete() {
    return [settings.profile.username, settings.profile.email, settings.profile.team].every(
      (field) => field.trim() !== '',
    )
  }
  function chosenModel() {
    const offered = offeredModels()
    if (offered.includes(settings.model)) return settings.model
    const active = settings.keys.find((key) => key.active)
    if (!active) throw new Error('No model')
    if (offered.length === 0) return ''
    return modelCatalog[active.provider].defaultModel || offered[0]
  }
  function refreshDiscovery() {
    if (offeredModels().length === 0) return
    writeDiscoverySkills(machine, directory, chosenModel())
  }
  refreshDiscovery()
  function listedTools(): InstalledTool[] {
    const disabled = new Set(settings.disabledTools)
    return scanTools(machine).map((tool) => ({
      ...tool,
      enabled: !disabled.has(tool.id),
    }))
  }
  return {
    saveProfile(profile: Profile) {
      settings.profile = {
        username: profile.username,
        email: profile.email,
        team: profile.team,
      }
      writeSettings(directory, settings)
    },
    profile(): Profile {
      return { ...settings.profile }
    },
    saveKey(input: { provider: Provider; secret: string; account?: CursorAccount }) {
      if (!settings.vaultId) settings.vaultId = randomUUID()
      const id = randomUUID()
      writeSecret(settings.vaultId, id, input.secret)
      settings.keys.push({ id, provider: input.provider, active: false })
      const chosen = chosenKey()
      for (const key of settings.keys) key.active = chosen ? key.id === chosen.id : false
      if (input.provider === 'cursor' && input.account) {
        settings.cursorModels = input.account.models
        settings.cursorKey = {
          createdAt: input.account.createdAt ?? '',
          expiresAt: input.account.expiresAt ?? '',
          error: input.account.error ?? '',
        }
        if (!settings.cursorModels.some((model) => model.id === settings.model)) {
          settings.model = settings.cursorModels[0]?.id ?? ''
        }
      }
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    lookupCursor(secret: string) {
      return cursorLookup(secret)
    },
    cursorSecret() {
      const key = [...settings.keys].reverse().find((item) => item.provider === 'cursor')
      if (!key || !settings.vaultId) return ''
      try {
        return readSecret(settings.vaultId, key.id)
      } catch {
        return ''
      }
    },
    rememberCursor(account: CursorAccount) {
      if (account.error || account.models.length === 0) {
        settings.cursorKey = {
          ...settings.cursorKey,
          error: account.error || 'Cursor model list failed',
        }
        writeSettings(directory, settings)
        return
      }
      settings.cursorModels = account.models
      settings.cursorKey = {
        createdAt: account.createdAt || settings.cursorKey.createdAt,
        expiresAt: account.expiresAt || settings.cursorKey.expiresAt,
        error: '',
      }
      const active = settings.keys.find((item) => item.active)
      if (active?.provider === 'cursor' && !settings.cursorModels.some((model) => model.id === settings.model)) {
        settings.model = settings.cursorModels[0]?.id ?? ''
      }
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    activateKey(id: string) {
      const match = settings.keys.find((key) => key.id === id)
      if (!match) throw new Error(`No key ${id}`)
      settings.selectedProvider = match.provider
      settings.pinnedKeyId = id
      for (const key of settings.keys) key.active = key.id === id
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    activateProvider(provider: Provider) {
      settings.selectedProvider = provider
      const matches = settings.keys.filter((key) => key.provider === provider)
      if (matches.length === 0) {
        settings.pinnedKeyId = ''
        for (const key of settings.keys) key.active = false
        writeSettings(directory, settings)
        return
      }
      const chosen = matches.find((key) => key.id === settings.pinnedKeyId) ?? matches[matches.length - 1]
      this.activateKey(chosen.id)
    },
    activeProvider() {
      return settings.selectedProvider || settings.keys.find((key) => key.active)?.provider || ''
    },
    modelsFor(provider: Provider) {
      return modelChoices(provider).map((model) => model.id)
    },
    modelChoices,
    cursorKey() {
      return { ...settings.cursorKey }
    },
    revokeProvider(provider: Provider) {
      const removed = settings.keys.filter((key) => key.provider === provider)
      for (const key of removed) {
        try {
          deleteSecret(settings.vaultId, key.id)
        } catch {
          // The vault entry is already gone.
        }
      }
      if (removed.some((key) => key.id === settings.pinnedKeyId)) settings.pinnedKeyId = ''
      settings.keys = settings.keys.filter((key) => key.provider !== provider)
      if (provider === 'cursor') {
        settings.cursorModels = []
        settings.cursorKey = { createdAt: '', expiresAt: '', error: '' }
      }
      if (settings.selectedProvider === provider && !settings.keys.some((key) => key.provider === provider)) {
        for (const key of settings.keys) key.active = false
        settings.model = ''
      } else {
        const chosen = chosenKey()
        for (const key of settings.keys) key.active = chosen ? key.id === chosen.id : false
        const offered = offeredModels()
        if (!offered.includes(settings.model)) {
          settings.model = chosen ? modelCatalog[chosen.provider].defaultModel || offered[0] || '' : ''
        }
      }
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    keys(): SavedKey[] {
      return settings.keys.map(({ id, provider, active }) => ({ id, provider, active }))
    },
    activeKey() {
      const key = settings.keys.find((item) => item.active)
      if (!key) throw new Error('No active key')
      return {
        id: key.id,
        provider: key.provider,
        secret: readSecret(settings.vaultId, key.id),
      }
    },
    models() {
      return offeredModels()
    },
    selectModel(model: string) {
      if (!offeredModels().includes(model)) throw new Error(`${model} is not offered`)
      settings.model = model
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    chosenModel,
    tools: listedTools,
    setToolEnabled(label: string, enabled: boolean) {
      const tool = scanTools(machine).find((item) => item.label === label)
      if (!tool) throw new Error(`${label} is not installed`)
      const disabled = new Set(settings.disabledTools)
      if (enabled) disabled.delete(tool.id)
      else disabled.add(tool.id)
      settings.disabledTools = [...disabled]
      writeSettings(directory, settings)
    },
    beginLearning(transcripts: Transcript[] = []) {
      if (!profileIsComplete()) {
        return 'Save your username, email, and team before learning can write cards.'
      }
      if (offeredModels().length === 0) {
        return 'This SDK has no model list. Switch to Anthropic or OpenAI to start learning.'
      }
      settings.learningStarted = true
      writeSettings(directory, settings)
      this.runLearner(transcripts)
      return ''
    },
    runLearner(transcripts: Transcript[] = []) {
      if (!profileIsComplete() || offeredModels().length === 0) return { ran: false }
      const model = chosenModel()
      const installed = new Set<string>(listedTools().map((tool) => tool.id))
      const readable = newestFirst(
        transcripts.filter(
          (transcript) =>
            installed.has(transcript.source) &&
            settings.importedTranscripts[transcriptKey(transcript)] !== transcriptRevision(transcript),
        ),
      )
      if (readable.length === 0) return { ran: true, model }
      if (!complete) throw new Error('No model')
      for (let start = 0; start < readable.length; start += importBatchSize) {
        const batch = readable.slice(start, start + importBatchSize)
        const projects = knowledgeProjects(directory)
        const stored = readStoredCards(directory)
        const cards: KnownCard[] = stored.map((card) => ({
          id: card.id,
          sources: card.sources,
          title: card.title,
          topics: card.topics,
          summary: card.summary,
          situation: card.situation,
          whatToDo: card.whatToDo,
          why: card.why,
          apply: card.apply,
        }))
        const lessons = batch.map((transcript) => ({
          transcript,
          lesson: complete({ model, transcript, transcripts: batch, projects, cards }),
        }))
        for (const { transcript, lesson } of lessons) {
          if (lesson.sameClaim) continue
          const recorded =
            [transcript.repo, transcript.workspace].find((name) => name && filled(name))?.trim() ?? null
          const subject =
            lesson.clearlyOneProduct && lesson.subjectProject && filled(lesson.subjectProject)
              ? (knownProject(lesson.subjectProject, projects) ?? lesson.subjectProject.trim())
              : null
          const existing = knownProject(lesson.belongsToProject, projects)
          const project = existing ?? (lesson.generalTechnique ? 'none' : (recorded ?? subject ?? 'none'))
          const keep = [
            settings.profile.username,
            settings.profile.email,
            settings.profile.team,
            ...projects,
            project,
          ].filter((term, index, all) => filled(term) && term !== 'none' && all.indexOf(term) === index)
          const names = Array.isArray(lesson.otherNames) ? lesson.otherNames : []
          const scrubbed: LessonDraft = {
            ...lesson,
            title: scrubText(asText(lesson.title), names, keep),
            topics: (Array.isArray(lesson.topics) ? lesson.topics : [])
              .map((topic) => scrubText(asText(topic), names, keep))
              .filter(filled),
            summary: scrubText(asText(lesson.summary), names, keep),
            situation: scrubText(asText(lesson.situation), names, keep),
            whatToDo: scrubText(asText(lesson.whatToDo), names, keep),
            why: scrubText(asText(lesson.why), names, keep),
            apply: scrubText(asText(lesson.apply), names, keep),
          }
          const previous = lesson.updateId ? stored.find((card) => card.id === lesson.updateId) : undefined
          if (lesson.updateId && !previous) continue
          const sources = [
            ...new Set(
              [
                ...(previous?.sources ?? []),
                ...(Array.isArray(lesson.sources) && lesson.sources.length > 0
                  ? lesson.sources
                  : [transcript.source]),
              ]
                .map((source) => asText(source).trim())
                .filter(filled),
            ),
          ]
          if (!lessonIsComplete(scrubbed, sources[0] ?? '')) continue
          const id = previous?.id ?? randomUUID()
          const folder =
            scrubbed.scope === 'personal'
              ? join(directory, 'personal')
              : join(directory, 'work', settings.profile.team)
          if (!previous) mkdirSync(folder, { recursive: true })
          writeFileSync(
            previous?.path ?? join(folder, `${slug(scrubbed.title)}-${id}.md`),
            renderCard({
              id,
              at: previous?.at ?? new Date().toISOString(),
              author: settings.profile,
              scope: scrubbed.scope,
              sources,
              project,
              title: scrubbed.title,
              topics: scrubbed.topics,
              summary: scrubbed.summary,
              situation: scrubbed.situation,
              whatToDo: scrubbed.whatToDo,
              why: scrubbed.why,
              apply: scrubbed.apply,
            }),
          )
        }
        for (const transcript of batch) {
          settings.importedTranscripts[transcriptKey(transcript)] = transcriptRevision(transcript)
        }
        writeSettings(directory, settings)
      }
      return { ran: true, model }
    },
    answerLookup() {
      return { model: chosenModel() }
    },
    async lookup(question: string) {
      const model = chosenModel()
      if (!answer) throw new Error('No model')
      const stored = readStoredCards(directory)
      const catalog = stored
        .map((card) => ({ file: cardFile(directory, card.path), summary: card.summary }))
        .sort((left, right) => left.file.localeCompare(right.file))
      const picked = await answer({ model, question, catalog })
      const pick = new Set('pick' in picked ? picked.pick : [])
      const cards = stored
        .map((card) => ({
          file: cardFile(directory, card.path),
          text: readFileSync(card.path, 'utf8'),
        }))
        .filter((card) => pick.has(card.file))
        .sort((left, right) => left.file.localeCompare(right.file))
      const answered = await answer({ model, question, cards })
      return { model, answer: 'answer' in answered ? answered.answer : '' }
    },
    learnerInterval() {
      return settings.learnerIntervalMs
    },
    setLearnerInterval(intervalMs: number) {
      requireAtLeastOneHour(intervalMs, 'Learner')
      settings.learnerIntervalMs = intervalMs
      writeSettings(directory, settings)
    },
    drivePath() {
      return settings.drivePath
    },
    setDrivePath(path: string) {
      settings.drivePath = path
      writeSettings(directory, settings)
    },
    runPublisher() {
      if (settings.drivePath.trim() === '') return { ran: false }
      copyWorkTree(join(directory, 'work'), settings.drivePath)
      return { ran: true }
    },
    graph() {
      const accent = '#88c0d0'
      const nodes = new Map<
        string,
        { id: string; kind: GraphKind; label: string; color: string; synced?: boolean }
      >()
      const links: { source: string; target: string }[] = []
      function ensure(kind: GraphKind, key: string, label: string) {
        const id = `${kind}:${key}`
        if (!nodes.has(id)) nodes.set(id, { id, kind, label, color: accent })
        return id
      }
      for (const card of readStoredCards(directory)) {
        const cardId = ensure('card', card.id, card.title)
        const synced = cardIsSynced(directory, settings.drivePath, card)
        const cardNode = nodes.get(cardId)!
        cardNode.synced = synced
        cardNode.color = synced ? '#a3be8c' : accent
        const link = (other: string) => links.push({ source: cardId, target: other })
        link(ensure('person', card.author.email, card.author.username))
        link(ensure('team', card.author.team, card.author.team))
        link(ensure('project', card.project, card.project))
        for (const source of card.sources) link(ensure('source', source, source))
        for (const topic of card.topics) link(ensure('topic', topic, topic))
      }
      return {
        canvas: '#2e3440',
        panel: '#3b4252',
        text: '#eceff4',
        accent,
        nodes: [...nodes.values()],
        links,
      }
    },
    show(id: string) {
      const split = id.indexOf(':')
      const kind = id.slice(0, split)
      const key = id.slice(split + 1)
      const cards = readStoredCards(directory)
      const titles = (matched: StoredCard[]) =>
        matched.map((card) => card.title).sort((left, right) => left.localeCompare(right))
      if (kind === 'card') {
        const card = cards.find((item) => item.id === key)
        if (!card) throw new Error(`No node ${id}`)
        return {
          kind: 'card' as const,
          title: card.title,
          summary: card.summary,
          situation: card.situation,
          whatToDo: card.whatToDo,
          why: card.why,
          apply: card.apply,
          synced: cardIsSynced(directory, settings.drivePath, card),
        }
      }
      if (kind === 'person') {
        const matched = cards.filter((card) => card.author.email === key)
        const author = matched[0]?.author
        if (!author) throw new Error(`No node ${id}`)
        return {
          kind: 'person' as const,
          username: author.username,
          email: author.email,
          team: author.team,
          cards: titles(matched),
        }
      }
      const named = (name: string, matched: StoredCard[]) => {
        if (matched.length === 0) throw new Error(`No node ${id}`)
        return { kind: kind as 'team' | 'project' | 'source' | 'topic', name, cards: titles(matched) }
      }
      if (kind === 'team') return named(key, cards.filter((card) => card.author.team === key))
      if (kind === 'project') return named(key, cards.filter((card) => card.project === key))
      if (kind === 'source') return named(key, cards.filter((card) => card.sources.includes(key)))
      if (kind === 'topic') return named(key, cards.filter((card) => card.topics.includes(key)))
      throw new Error(`No node ${id}`)
    },
    publisherInterval() {
      return settings.publisherIntervalMs
    },
    setPublisherInterval(intervalMs: number) {
      requireAtLeastOneHour(intervalMs, 'Publisher')
      settings.publisherIntervalMs = intervalMs
      writeSettings(directory, settings)
    },
  }
}

type ScheduledJobs = {
  learnerDue: number | null
  publisherDue: number | null
}

export function openUserSession(
  person: string,
  complete?: CompleteLesson,
  machine: Machine = thisMachine(),
  readTranscripts: () => Transcript[] = () => [],
  cursorLookup: CursorLookup = lookupCursorAccount,
) {
  let loggedIn = false
  const jobs = new Map<string, ScheduledJobs>()

  function scheduled(directory: string) {
    const existing = jobs.get(directory)
    if (existing) return existing
    const created: ScheduledJobs = { learnerDue: null, publisherDue: null }
    jobs.set(directory, created)
    return created
  }

  function learn(directory: string) {
    if (!readSettings(directory).learningStarted) return
    openApp(directory, complete, machine, undefined, cursorLookup).runLearner(readTranscripts())
  }

  function publish(directory: string) {
    openApp(directory, complete, machine, undefined, cursorLookup).runPublisher()
  }

  function arm(directory: string) {
    const settings = readSettings(directory)
    const entry = scheduled(directory)
    entry.learnerDue = settings.learnerIntervalMs
    entry.publisherDue = settings.publisherIntervalMs
  }

  function start(directory: string) {
    if (!loggedIn) return
    learn(directory)
    publish(directory)
    arm(directory)
  }

  function registryPath() {
    return join(machine.home, '.sharlie', `${person}.json`)
  }

  function readRegistry() {
    try {
      const parsed = JSON.parse(readFileSync(registryPath(), 'utf8')) as {
        directories?: unknown
        knowledge?: unknown
      }
      const directories = Array.isArray(parsed.directories)
        ? parsed.directories.filter((directory): directory is string => typeof directory === 'string')
        : []
      const knowledge =
        typeof parsed.knowledge === 'string' && parsed.knowledge.trim() !== '' ? parsed.knowledge : undefined
      return knowledge ? { directories, knowledge } : { directories }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { directories: [] }
      throw error
    }
  }

  function writeRegistryFile(registry: { directories: string[]; knowledge?: string }) {
    mkdirSync(join(machine.home, '.sharlie'), { recursive: true })
    writeFileSync(registryPath(), JSON.stringify(registry))
  }

  function registeredDirectories() {
    return readRegistry().directories
  }

  function writeRegistry(directories: string[]) {
    const current = readRegistry()
    writeRegistryFile(current.knowledge ? { directories, knowledge: current.knowledge } : { directories })
  }

  function storedKnowledge(fallback: string) {
    return readRegistry().knowledge ?? fallback
  }

  function remember(directory: string) {
    const directories = registeredDirectories()
    if (!directories.includes(directory)) writeRegistry([...directories, directory])
  }

  function forget(directory: string) {
    writeRegistry(registeredDirectories().filter((item) => item !== directory))
  }

  function endSession() {
    loggedIn = false
    for (const entry of jobs.values()) {
      entry.learnerDue = null
      entry.publisherDue = null
    }
  }

  function register(directory: string) {
    remember(directory)
    scheduled(directory)
    start(directory)
  }

  function unregister(directory: string) {
    forget(directory)
    jobs.delete(directory)
  }

  return {
    logIn() {
      if (loggedIn) return
      loggedIn = true
      for (const directory of new Set([...registeredDirectories(), ...jobs.keys()])) {
        scheduled(directory)
        start(directory)
      }
    },
    logOut() {
      endSession()
    },
    shutDown() {
      endSession()
    },
    pass(ms: number) {
      if (!loggedIn) return
      for (const [directory, entry] of jobs) {
        if (entry.learnerDue === null || entry.publisherDue === null) continue
        entry.learnerDue -= ms
        entry.publisherDue -= ms
        const settings = () => readSettings(directory)
        while (entry.learnerDue <= 0) {
          learn(directory)
          entry.learnerDue += settings().learnerIntervalMs
        }
        while (entry.publisherDue <= 0) {
          publish(directory)
          entry.publisherDue += settings().publisherIntervalMs
        }
      }
    },
    install(directory: string) {
      register(directory)
    },
    uninstall(directory: string) {
      unregister(directory)
    },
    openWindow(directory: string) {
      const current = storedKnowledge(directory)
      const window = openApp(current, complete, machine, undefined, cursorLookup)
      return {
        ...window,
        knowledgePath() {
          return current
        },
        startLearning() {
          return window.beginLearning(readTranscripts())
        },
        setKnowledgePath(path: string) {
          const next = path.trim()
          if (next === '') throw new Error('knowledge path is required')
          if (next === current) return
          mkdirSync(next, { recursive: true })
          const previousSettings = join(current, 'settings.json')
          const nextSettings = join(next, 'settings.json')
          if (existsSync(previousSettings) && !existsSync(nextSettings)) {
            copyFileSync(previousSettings, nextSettings)
          }
          if (registeredDirectories().includes(current)) {
            unregister(current)
            register(next)
          }
          const registry = readRegistry()
          writeRegistryFile({ directories: registry.directories, knowledge: next })
        },
        registerJobs() {
          register(current)
        },
        unregisterJobs() {
          unregister(current)
        },
        close() {},
      }
    },
    knowledgeDirectory(fallback: string) {
      return storedKnowledge(fallback)
    },
  }
}
