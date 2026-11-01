import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, relative, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerLoginItem, unregisterLoginItem } from './login-item.ts'
import { localGraph, publishCard, readCards, type CardRelation } from './synapse.ts'
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
  context?: { os: string; tool_version: string; framework: string }
  solution?: string
  failure_modes?: string[]
  relations?: CardRelation[]
}

export type CompleteLesson = (request: {
  model: string
  transcript: Transcript
  transcripts: Transcript[]
  projects: string[]
  cards: KnownCard[]
}) => LessonDraft | Promise<LessonDraft>

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
  baseUrl?: string
  chatCompletions?: boolean
  cwd?: string
}

export type ModelExchange = (request: ModelRequest) => string | Promise<string>

export type AnswerLookup = (
  turn: LookupTurn,
) =>
  | { pick: string[] }
  | { answer: string }
  | Promise<{ pick: string[] } | { answer: string }>

export type Provider = 'cursor' | 'copilot' | 'anthropic' | 'openai' | 'custom'

export type ListedModel = {
  id: string
  displayName: string
  chatCompletions?: boolean
}

export type CursorAccount = {
  models: ListedModel[]
  createdAt?: string
  expiresAt?: string
  error?: string
}

export type CursorLookup = (secret: string) => Promise<CursorAccount>

export type ToolId = 'cursor' | 'copilot' | 'claude' | 'cursor-cli' | 'claude-cli' | 'copilot-cli'

export type SourceFolder = { tool: string; path: string }

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
  copilotModels: ListedModel[]
  cursorKey: { createdAt: string; expiresAt: string; error: string }
  selectedProvider: Provider | ''
  customBaseUrl: string
  customModel: string
  autoDrop: boolean
}

const emptyProfile = (): Profile => ({ username: '', email: '', team: '' })

const hourMs = 60 * 60 * 1000
const thirtyMin = 30 * 60 * 1000
const importBatchSize = 10

const fifteenMin = 15 * 60 * 1000

function requireInterval(intervalMs: number, job: string) {
  if (intervalMs !== 0 && intervalMs !== fifteenMin && intervalMs !== thirtyMin && intervalMs !== hourMs) {
    throw new Error(`${job} interval must be 15 minutes, 30 minutes, 1 hour, or manual`)
  }
}

const keyOrder: Record<Provider, number> = {
  cursor: 0,
  copilot: 1,
  anthropic: 2,
  openai: 3,
  custom: 4,
}

const modelCatalog: Record<Provider, { models: string[]; defaultModel: string }> = {
  cursor: { models: [], defaultModel: '' },
  copilot: { models: [], defaultModel: '' },
  anthropic: {
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-5-5',
  },
  openai: {
    models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'],
    defaultModel: 'gpt-6-luna',
  },
  custom: { models: [], defaultModel: '' },
}

function providerName(value: unknown): Provider | '' {
  return value === 'cursor' || value === 'copilot' || value === 'anthropic' || value === 'openai' || value === 'custom'
    ? value
    : ''
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
    const chatCompletions = (record as { chatCompletions?: unknown }).chatCompletions
    return [{ id: record.id, displayName, ...(chatCompletions === false ? { chatCompletions: false as const } : {}) }]
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
    learnerIntervalMs: thirtyMin,
    publisherIntervalMs: thirtyMin,
    drivePath: '',
    disabledTools: [],
    learningStarted: false,
    importedTranscripts: {},
    cursorModels: [],
    copilotModels: [],
    cursorKey: { createdAt: '', expiresAt: '', error: '' },
    selectedProvider: '',
    customBaseUrl: '',
    customModel: '',
    autoDrop: false,
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
      copilotModels: listedModels(parsed.copilotModels),
      cursorKey: cursorKeyInfo(parsed.cursorKey),
      selectedProvider: providerName(parsed.selectedProvider),
      customBaseUrl: parsed.customBaseUrl ?? defaults.customBaseUrl,
      customModel: parsed.customModel ?? defaults.customModel,
      autoDrop: parsed.autoDrop ?? defaults.autoDrop,
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
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, '[redacted]')
    .replace(
      /\b([A-Za-z_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY)[A-Za-z0-9_]*)(\s*=\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s\n]+)/gi,
      '$1$2[redacted]',
    )
    .replace(/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[redacted]')
    .replace(/\b172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g, '[redacted]')
    .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, '[redacted]')
    .replace(/\b169\.254\.\d{1,3}\.\d{1,3}\b/g, '[redacted]')
    .replace(
      /(?<![\w:])(?:(?:fc|fd)[0-9a-f]{2}|fe[89ab][0-9a-f])(?::[0-9a-f]{0,4}){1,7}(?![\w:])/gi,
      '[redacted]',
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

function knowledgeProjects(directory: string) {
  const found: string[] = []
  for (const card of readCards(directory)) {
    const project = card.context.framework
    if (project && project !== 'none' && !found.includes(project)) found.push(project)
  }
  return found
}

type StoredCard = KnownCard & {
  path: string
  at: string
  author: Profile
  project: string
}

function readStoredCards(directory: string): StoredCard[] {
  return readCards(directory).map((card) => ({
    path: join(directory, 'cards', `${card.id}.md`),
    id: card.id,
    at: card.created_at,
    author: card.author,
    sources: card.sources,
    project: card.context.framework || 'none',
    title: card.title,
    topics: card.relations.map((relation) => relation.target_entity),
    summary: card.title,
    situation: card.failure_modes[0] ?? '',
    whatToDo: card.solution,
    why: card.failure_modes[1] ?? '',
    apply: card.failure_modes[2] ?? '',
  }))
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

function roamingAppData(machine: Machine) {
  if (machine.platform === 'darwin') return join(machine.home, 'Library', 'Application Support')
  return join(machine.home, 'AppData', 'Roaming')
}

function baseName(path: string) {
  if (!path) return undefined
  return path.split(/[/\\]/).filter(Boolean).pop()
}

function directoryNames(root: string) {
  if (!isDirectory(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function namedFiles(root: string, accept: (name: string) => boolean, nested: boolean) {
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
      if (entry.name === 'state.vscdb' || entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (nested) stack.push(path)
        continue
      }
      if (entry.isFile() && accept(entry.name)) found.push(path)
    }
  }
  return found
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean).join('\n')
  if (!value || typeof value !== 'object') return ''
  const record = value as { text?: unknown; value?: unknown; content?: unknown }
  if (typeof record.text === 'string' && record.text.trim()) return record.text.trim()
  if (typeof record.value === 'string' && record.value.trim()) return record.value.trim()
  if ('content' in record && record.content !== value) return textValue(record.content)
  return ''
}

function eventText(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const record = value as { type?: unknown; data?: unknown }
  if (record.type !== 'user.message' && record.type !== 'assistant.message') return ''
  if (!record.data || typeof record.data !== 'object') return ''
  return textValue((record.data as { content?: unknown }).content)
}

function textsFromRequest(value: unknown) {
  if (!value || typeof value !== 'object') return []
  const request = value as { message?: unknown; response?: unknown }
  const parts: string[] = []
  const message = textValue(request.message)
  if (message) parts.push(message)
  const response = request.response
  if (typeof response === 'string') {
    if (response.trim()) parts.push(response.trim())
  } else if (Array.isArray(response)) {
    for (const part of response) {
      const text = textValue(part)
      if (text) parts.push(text)
    }
  } else {
    const text = textValue(response)
    if (text) parts.push(text)
  }
  return parts
}

function textsFromChat(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => textsFromChat(item))
  if (!value || typeof value !== 'object') return []
  const record = value as { kind?: unknown; v?: unknown; requests?: unknown; messages?: unknown }
  if (record.kind === 0) return textsFromChat(record.v)
  if (Array.isArray(record.requests)) return record.requests.flatMap((item) => textsFromRequest(item))
  if (Array.isArray(record.messages)) {
    return record.messages.map((item) => lineText(item) || textValue(item)).filter((text) => text !== '')
  }
  const event = eventText(value)
  if (event) return [event]
  if ('message' in record || 'response' in record) return textsFromRequest(value)
  const line = lineText(value)
  return line ? [line] : []
}

function isIndex(part: string | number) {
  return typeof part === 'number' || (typeof part === 'string' && /^\d+$/.test(part))
}

function applyChatOp(state: unknown, op: unknown) {
  if (!op || typeof op !== 'object') return state
  const record = op as { kind?: unknown; k?: unknown; v?: unknown }
  if (record.kind === 0) return record.v && typeof record.v === 'object' ? record.v : state
  if (record.kind !== 1 && record.kind !== 2 && record.kind !== 3) return state
  if (!Array.isArray(record.k) || record.k.length === 0) return state
  const path = record.k.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
  if (path.length !== record.k.length) return state
  const root = state && typeof state === 'object' ? (state as Record<string | number, unknown>) : {}
  let parent: Record<string | number, unknown> = root
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index]
    const next = path[index + 1]
    const current = parent[key]
    if (current == null || typeof current !== 'object') parent[key] = isIndex(next) ? [] : {}
    parent = parent[key] as Record<string | number, unknown>
  }
  const last = path[path.length - 1]
  if (record.kind === 3) {
    if (Array.isArray(parent) && isIndex(last)) parent.splice(Number(last), 1)
    else delete parent[last]
    return root
  }
  if (record.kind === 2) {
    if (!Array.isArray(parent[last])) parent[last] = []
    const target = parent[last] as unknown[]
    if (Array.isArray(record.v)) target.push(...record.v)
    else target.push(record.v)
    return root
  }
  parent[last] = record.v
  return root
}

function parsedLines(raw: string) {
  const parsed: unknown[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      parsed.push(JSON.parse(line) as unknown)
    } catch {
      continue
    }
  }
  return parsed
}

function conversationFromParsed(parsed: unknown[]) {
  const op = parsed.some(
    (item) => !!item && typeof item === 'object' && typeof (item as { kind?: unknown }).kind === 'number',
  )
  if (!op) return parsed.flatMap((item) => textsFromChat(item))
  let state: unknown = {}
  for (const item of parsed) state = applyChatOp(state, item)
  return textsFromChat(state)
}

function eventCwd(parsed: unknown[]) {
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as { type?: unknown; data?: { context?: { cwd?: unknown } } }
    if (record.type !== 'session.start') continue
    const cwd = record.data?.context?.cwd
    if (typeof cwd === 'string' && cwd.trim()) return cwd.trim()
  }
  return ''
}

function transcriptFromChatFile(file: string, source: string, root: string, repo?: string): Transcript | null {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const jsonl = file.endsWith('.jsonl')
  const parsed = jsonl ? parsedLines(raw) : []
  let parts: string[] = []
  if (jsonl) parts = conversationFromParsed(parsed)
  else {
    try {
      parts = textsFromChat(JSON.parse(raw) as unknown)
    } catch {
      return null
    }
  }
  const text = parts.join('\n').trim()
  if (!text) return null
  const slug = relative(root, file).split(/[/\\]/)[0]
  const nested = slug && slug !== file && !/\.jsonl?$/.test(slug) ? slug : undefined
  return {
    id: file,
    source,
    text,
    repo: repo || baseName(jsonl ? eventCwd(parsed) : '') || nested,
    changedAt: statSync(file).mtime.toISOString(),
  }
}

function fileUriToPath(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return ''
    let path = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:/.test(path)) path = win32.normalize(path.slice(1))
    return path
  } catch {
    return ''
  }
}

function folderFromWorkspaceJson(file: string) {
  if (!isFile(file)) return ''
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { folder?: unknown }
    if (typeof parsed.folder !== 'string' || parsed.folder === '') return ''
    const path = parsed.folder.startsWith('file:') ? fileUriToPath(parsed.folder) : parsed.folder
    return isDirectory(path) ? path : ''
  } catch {
    return ''
  }
}

function trustedWorkspacePath(file: string) {
  if (!isFile(file)) return ''
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { workspacePath?: unknown }
    return typeof parsed.workspacePath === 'string' ? parsed.workspacePath : ''
  } catch {
    return ''
  }
}

function resolveSlug(api: typeof win32, root: string, tokens: string[]) {
  let current = root
  let index = 0
  while (index < tokens.length) {
    let matched = -1
    for (let end = tokens.length; end > index; end--) {
      const name = tokens.slice(index, end).join('-')
      if (!name) continue
      if (isDirectory(api.join(current, name))) {
        matched = end
        break
      }
    }
    if (matched < 0) return ''
    current = api.join(current, tokens.slice(index, matched).join('-'))
    index = matched
  }
  return current
}

function decodeCursorSlug(machine: Machine, slug: string) {
  const api = machine.platform === 'win32' ? win32 : posix
  if (machine.platform === 'win32') {
    const match = /^([A-Za-z])-(.+)$/.exec(slug)
    if (!match) return ''
    return resolveSlug(api, `${match[1].toUpperCase()}:\\`, match[2].split('-'))
  }
  if (!slug) return ''
  return resolveSlug(api, '/', slug.split('-'))
}

function pathKey(machine: Machine, path: string) {
  const normal = (machine.platform === 'win32' ? win32 : posix).normalize(path)
  return machine.platform === 'win32' ? normal.toLowerCase() : normal
}

function addUnique(machine: Machine, roots: string[], path: string) {
  if (!path || !isDirectory(path)) return
  const key = pathKey(machine, path)
  if (roots.some((root) => pathKey(machine, root) === key)) return
  roots.push(path)
}

function workspaceNoteRoots(machine: Machine) {
  const roots: string[] = []
  const projects = join(machine.home, '.cursor', 'projects')
  for (const name of directoryNames(projects)) {
    const trusted = trustedWorkspacePath(join(projects, name, '.workspace-trusted'))
    addUnique(machine, roots, isDirectory(trusted) ? trusted : decodeCursorSlug(machine, name))
  }
  const storage = join(roamingAppData(machine), 'Code', 'User', 'workspaceStorage')
  for (const name of directoryNames(storage)) {
    addUnique(machine, roots, folderFromWorkspaceJson(join(storage, name, 'workspace.json')))
  }
  return roots
}

function isWorkspaceNote(root: string, file: string, name: string) {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.md')) return false
  if (lower.endsWith('.plan.md') || lower === 'readme.md' || lower.includes('architecture')) return true
  const rel = relative(root, file).split('\\').join('/').toLowerCase()
  return /^docs\/(?:.+\/)?adr\/.+\.md$/.test(rel)
}

function noteFiles(root: string) {
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
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      if (entry.isFile() && isWorkspaceNote(root, path, entry.name)) found.push(path)
    }
  }
  return found
}

function transcriptFromNote(file: string, root: string): Transcript | null {
  let text = ''
  try {
    text = readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
  if (!text) return null
  return {
    id: file,
    source: 'workspace',
    text,
    repo: baseName(root),
    changedAt: statSync(file).mtime.toISOString(),
  }
}

function sessionJsonl(root: string) {
  return jsonlFiles(root).filter((file) => file.split(/[/\\]/).pop() !== 'audit.jsonl')
}

function copilotCliFiles(root: string) {
  if (!isDirectory(root)) return []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path)
    else if (entry.isDirectory() && isFile(join(path, 'events.jsonl'))) found.push(join(path, 'events.jsonl'))
  }
  return found
}

function collectInstalledSources(machine: Machine) {
  const installed = new Set(scanTools(machine).map((tool) => tool.id))
  const folders: SourceFolder[] = []
  const seen = new Set<string>()
  const transcripts: Transcript[] = []
  function walk(folder: string, tool: string, files: string[], read: (file: string) => Transcript | null) {
    if (!isDirectory(folder)) return
    folders.push({ tool, path: folder })
    for (const file of files) {
      if (seen.has(file)) continue
      seen.add(file)
      const transcript = read(file)
      if (transcript) transcripts.push(transcript)
    }
  }
  const projects = join(machine.home, '.cursor', 'projects')
  const agentFiles = () => jsonlFiles(projects).filter((file) => file.split(/[/\\]/).includes('agent-transcripts'))
  if (installed.has('cursor')) walk(projects, 'Cursor', agentFiles(), (file) => transcriptFromFile(file, 'cursor', projects))
  if (installed.has('cursor-cli')) {
    const chats = join(machine.home, '.cursor', 'chats')
    walk(chats, 'Cursor CLI', jsonlFiles(chats), (file) => transcriptFromFile(file, 'cursor-cli', chats))
    walk(projects, 'Cursor CLI', agentFiles(), (file) => transcriptFromFile(file, 'cursor-cli', projects))
  }
  const claudeProjects = join(machine.home, '.claude', 'projects')
  if (installed.has('claude-cli')) {
    walk(claudeProjects, 'Claude CLI', jsonlFiles(claudeProjects), (file) =>
      transcriptFromFile(file, 'claude-cli', claudeProjects),
    )
  }
  if (installed.has('copilot')) {
    const user = join(roamingAppData(machine), 'Code', 'User')
    const storage = join(user, 'workspaceStorage')
    const accept = (name: string) => name.endsWith('.jsonl') || name.endsWith('.json')
    for (const id of directoryNames(storage)) {
      const home = join(storage, id)
      const repo = baseName(folderFromWorkspaceJson(join(home, 'workspace.json')))
      const sessions = join(home, 'chatSessions')
      const transcriptsFolder = join(home, 'GitHub.copilot-chat', 'transcripts')
      walk(sessions, 'Copilot in VS Code', namedFiles(sessions, accept, true), (file) =>
        transcriptFromChatFile(file, 'copilot', sessions, repo),
      )
      walk(transcriptsFolder, 'Copilot in VS Code', namedFiles(transcriptsFolder, accept, true), (file) =>
        transcriptFromChatFile(file, 'copilot', transcriptsFolder, repo),
      )
    }
    const empty = join(user, 'globalStorage', 'emptyWindowChatSessions')
    walk(empty, 'Copilot in VS Code', namedFiles(empty, accept, true), (file) =>
      transcriptFromChatFile(file, 'copilot', empty),
    )
  }
  if (installed.has('claude')) {
    const sessions = join(roamingAppData(machine), 'Claude', 'local-agent-mode-sessions')
    walk(sessions, 'Claude', sessionJsonl(sessions), (file) => transcriptFromFile(file, 'claude', sessions))
    if (installed.has('claude-cli')) {
      if (isDirectory(claudeProjects)) folders.push({ tool: 'Claude', path: claudeProjects })
    } else {
      walk(claudeProjects, 'Claude', jsonlFiles(claudeProjects), (file) => transcriptFromFile(file, 'claude', claudeProjects))
    }
  }
  if (installed.has('copilot-cli')) {
    const state = join(machine.home, '.copilot', 'session-state')
    walk(state, 'Copilot CLI', copilotCliFiles(state), (file) => transcriptFromChatFile(file, 'copilot-cli', state))
  }
  for (const root of workspaceNoteRoots(machine)) {
    walk(root, 'Workspace notes', noteFiles(root), (file) => transcriptFromNote(file, root))
  }
  return { folders, transcripts }
}

export function sourceFolders(machine: Machine = thisMachine()): SourceFolder[] {
  return collectInstalledSources(machine).folders
}

export function readInstalledTranscripts(machine: Machine = thisMachine()): Transcript[] {
  return collectInstalledSources(machine).transcripts
}

function onDisk(file: string) {
  if (file.includes('app.asar.unpacked')) return file
  return file.replaceAll('app.asar', 'app.asar.unpacked')
}

function cardFile(directory: string, path: string) {
  return relative(directory, path).split('\\').join('/')
}

function discoverySkill(knowledge: string, model: string) {
  const lookupCli = onDisk(fileURLToPath(new URL('./lookup-cli.ts', import.meta.url)))
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

export function renderLookup(turn: LookupTurn) {
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
  const stored = openApp(directory, undefined, machine)
  const key = stored.activeKey()
  const baseUrl = stored.customBaseUrl()
  const app = openApp(directory, undefined, machine, async (turn) => {
    const text = await exchange({
      provider: key.provider,
      secret: key.secret,
      model: turn.model,
      prompt: renderLookup(turn),
      baseUrl,
      chatCompletions: key.provider === 'copilot' ? stored.copilotChat(turn.model) : undefined,
      cwd: directory,
    })
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? text
    return JSON.parse(json) as { pick: string[] } | { answer: string }
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
    if (provider === 'copilot') return settings.copilotModels
    if (provider === 'custom') {
      return settings.customModel === '' ? [] : [{ id: settings.customModel, displayName: settings.customModel }]
    }
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
    saveKey(input: { provider: Provider; secret: string; account?: CursorAccount; baseUrl?: string; model?: string }) {
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
      if (input.provider === 'copilot' && input.account) {
        settings.copilotModels = input.account.models
        if (!settings.copilotModels.some((model) => model.id === settings.model)) {
          settings.model = settings.copilotModels[0]?.id ?? settings.model
        }
      }
      if (input.provider === 'custom') {
        if (typeof input.baseUrl === 'string') settings.customBaseUrl = input.baseUrl
        if (typeof input.model === 'string' && input.model.trim() !== '') {
          settings.customModel = input.model.trim()
          settings.model = settings.customModel
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
    rememberCopilot(account: CursorAccount) {
      if (account.models.length === 0) return
      settings.copilotModels = account.models
      const active = settings.keys.find((item) => item.active)
      if (active?.provider === 'copilot' && !settings.copilotModels.some((model) => model.id === settings.model)) {
        settings.model = settings.copilotModels[0]?.id ?? ''
      }
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    customBaseUrl() {
      return settings.customBaseUrl
    },
    setCustomBaseUrl(url: string) {
      settings.customBaseUrl = url
      writeSettings(directory, settings)
    },
    copilotChat(model: string) {
      const found = settings.copilotModels.find((item) => item.id === model)
      return found?.chatCompletions !== false
    },
    autoDrop() {
      return settings.autoDrop
    },
    setAutoDrop(enabled: boolean) {
      settings.autoDrop = enabled
      writeSettings(directory, settings)
    },
    cadence() {
      if (settings.learnerIntervalMs === 0) return 'manual' as const
      if (settings.learnerIntervalMs === 15 * 60 * 1000) return '15m' as const
      if (settings.learnerIntervalMs === hourMs) return '1h' as const
      return '30m' as const
    },
    setCadence(cadence: '15m' | '30m' | '1h' | 'manual') {
      const interval =
        cadence === '15m' ? fifteenMin : cadence === '1h' ? hourMs : cadence === 'manual' ? 0 : thirtyMin
      settings.learnerIntervalMs = interval
      settings.publisherIntervalMs = interval
      writeSettings(directory, settings)
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
      if (provider === 'copilot') settings.copilotModels = []
      if (provider === 'custom') {
        settings.customBaseUrl = ''
        settings.customModel = ''
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
            (installed.has(transcript.source) || transcript.source === 'workspace') &&
            settings.importedTranscripts[transcriptKey(transcript)] !== transcriptRevision(transcript),
        ),
      )
      if (readable.length === 0) return { ran: true, model }
      if (!complete) throw new Error('No model')
      const pending: Promise<void>[] = []
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
        const keepNames = [settings.profile.username, settings.profile.email, settings.profile.team].filter(filled)
        const prepared = batch.map((original) => ({
          original,
          transcript: {
            ...original,
            text: scrubText(original.text, [], keepNames),
            repo: original.repo ? scrubText(original.repo, [], keepNames) : original.repo,
            workspace: original.workspace ? scrubText(original.workspace, [], keepNames) : original.workspace,
          },
        }))
        const lessons = prepared.map(({ original, transcript }) => ({
          original,
          transcript,
          lesson: complete({
            model,
            transcript,
            transcripts: prepared.map((item) => item.transcript),
            projects,
            cards,
          }),
        }))
        const writeLessons = (
          ready: { original: Transcript; transcript: Transcript; lesson: LessonDraft }[],
        ) => {
        for (const { original, transcript, lesson } of ready) {
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
            solution: lesson.solution ? scrubText(asText(lesson.solution), names, keep) : undefined,
            failure_modes: Array.isArray(lesson.failure_modes)
              ? lesson.failure_modes.map((mode) => scrubText(asText(mode), names, keep)).filter(filled)
              : undefined,
            context: lesson.context
              ? {
                  os: scrubText(asText(lesson.context.os), names, keep),
                  tool_version: scrubText(asText(lesson.context.tool_version), names, keep),
                  framework: scrubText(asText(lesson.context.framework), names, keep),
                }
              : undefined,
            relations: Array.isArray(lesson.relations)
              ? lesson.relations
                  .map((relation) => ({
                    entity: scrubText(asText(relation.entity), names, keep),
                    relation: asText(relation.relation).trim(),
                    target_entity: scrubText(asText(relation.target_entity), names, keep),
                  }))
                  .filter((relation) => filled(relation.entity) && filled(relation.relation) && filled(relation.target_entity))
              : undefined,
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
          const relations =
            scrubbed.relations && scrubbed.relations.length > 0
              ? scrubbed.relations
              : [
                  ...sources.map((source) => ({
                    entity: scrubbed.title,
                    relation: 'APPLIES_TO',
                    target_entity: source,
                  })),
                  ...(project !== 'none'
                    ? [{ entity: scrubbed.title, relation: 'RESOLVES', target_entity: project }]
                    : []),
                ]
          const failureModes = [
            ...(scrubbed.failure_modes?.length ? scrubbed.failure_modes : [scrubbed.situation]),
            scrubbed.why,
            scrubbed.apply,
          ].filter(filled)
          publishCard({
            directory,
            legacyId: previous?.id ?? randomUUID(),
            autoDrop: settings.autoDrop,
            drivePath: settings.drivePath,
            username: settings.profile.username,
            card: {
              title: scrubbed.title,
              context: scrubbed.context ?? {
                os: machine.platform,
                tool_version: '',
                framework: project,
              },
              solution: scrubbed.solution || scrubbed.whatToDo,
              failure_modes: failureModes,
              relations,
              sources,
              author: { ...settings.profile },
            },
          })
        }
        for (const item of ready) {
          settings.importedTranscripts[transcriptKey(item.original)] = transcriptRevision(item.original)
        }
        writeSettings(directory, settings)
        }
        if (lessons.some((item) => item.lesson instanceof Promise)) {
          pending.push(
            Promise.all(
              lessons.map(async (item) => ({
                original: item.original,
                transcript: item.transcript,
                lesson: await item.lesson,
              })),
            ).then((ready) => {
              writeLessons(ready)
            }),
          )
          continue
        }
        writeLessons(lessons as { original: Transcript; transcript: Transcript; lesson: LessonDraft }[])
      }
      if (pending.length > 0) return Promise.all(pending).then(() => ({ ran: true as const, model }))
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
      requireInterval(intervalMs, 'Learner')
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
      const username = settings.profile.username.trim()
      if (username === '') return { ran: false }
      const cardsDir = join(directory, 'cards')
      const names = existsSync(cardsDir)
        ? readdirSync(cardsDir).filter(
            (name) => name !== '.claims.json' && (name.endsWith('.md') || name.endsWith('.json')),
          )
        : []
      if (names.length === 0) return { ran: true }
      const dest = join(settings.drivePath, 'Dropzone', username)
      mkdirSync(dest, { recursive: true })
      for (const name of names) copyFileSync(join(cardsDir, name), join(dest, name))
      return { ran: true }
    },
    graph() {
      return localGraph(directory, settings.drivePath, settings.autoDrop)
    },
    show(id: string) {
      const split = id.indexOf(':')
      const kind = id.slice(0, split)
      const key = id.slice(split + 1)
      const cards = readCards(directory)
      const titles = (matched: typeof cards) =>
        matched.map((card) => card.title).sort((left, right) => left.localeCompare(right))
      const dropped = (card: (typeof cards)[number]) =>
        settings.drivePath.trim() !== '' &&
        existsSync(join(settings.drivePath, 'Dropzone', card.author.username, `${card.id}.json`))
      if (kind === 'card') {
        const card = cards.find((item) => item.id === key)
        if (!card) throw new Error(`No node ${id}`)
        return {
          kind: 'card' as const,
          title: card.title,
          solution: card.solution,
          failure_modes: card.failure_modes,
          created_at: card.created_at,
          synced: dropped(card),
        }
      }
      if (kind === 'developer') {
        const matched = cards.filter((card) => (card.author.email || card.author.username) === key)
        const author = matched[0]?.author
        if (!author) throw new Error(`No node ${id}`)
        return {
          kind: 'developer' as const,
          username: author.username,
          email: author.email,
          team: author.team,
          cards: titles(matched),
        }
      }
      const named = (name: string, matched: typeof cards) => {
        if (matched.length === 0) throw new Error(`No node ${id}`)
        return { kind: kind as 'tool' | 'issue' | 'antipattern', name, cards: titles(matched) }
      }
      const linked = cards.filter(
        (card) =>
          card.sources.includes(key) || card.relations.some((relation) => relation.target_entity === key),
      )
      if (kind === 'tool' || kind === 'issue' || kind === 'antipattern') return named(key, linked)
      throw new Error(`No node ${id}`)
    },
    publisherInterval() {
      return settings.publisherIntervalMs
    },
    setPublisherInterval(intervalMs: number) {
      requireInterval(intervalMs, 'Publisher')
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
  let harvestPaused = false
  let answer: AnswerLookup | undefined
  const jobs = new Map<string, ScheduledJobs>()
  const folders = () => sourceFolders(machine)

  function scheduled(directory: string) {
    const existing = jobs.get(directory)
    if (existing) return existing
    const created: ScheduledJobs = { learnerDue: null, publisherDue: null }
    jobs.set(directory, created)
    return created
  }

  function learn(directory: string) {
    if (!readSettings(directory).learningStarted) return
    return openApp(directory, complete, machine, answer, cursorLookup).runLearner(readTranscripts())
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
    registerLoginItem()
  }

  function unregister(directory: string) {
    forget(directory)
    jobs.delete(directory)
    if (registeredDirectories().length === 0) unregisterLoginItem()
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
      if (!loggedIn || harvestPaused) return
      for (const [directory, entry] of jobs) {
        if (entry.learnerDue === null || entry.publisherDue === null) continue
        const settings = () => readSettings(directory)
        const learnerInterval = settings().learnerIntervalMs
        const publisherInterval = settings().publisherIntervalMs
        if (learnerInterval > 0) {
          entry.learnerDue -= ms
          while (entry.learnerDue <= 0) {
            learn(directory)
            const step = settings().learnerIntervalMs
            if (step <= 0) {
              entry.learnerDue = 0
              break
            }
            entry.learnerDue += step
          }
        }
        if (publisherInterval > 0) {
          entry.publisherDue -= ms
          while (entry.publisherDue <= 0) {
            publish(directory)
            const step = settings().publisherIntervalMs
            if (step <= 0) {
              entry.publisherDue = 0
              break
            }
            entry.publisherDue += step
          }
        }
      }
    },
    pauseHarvest() {
      harvestPaused = true
    },
    resumeHarvest() {
      harvestPaused = false
    },
    harvestPaused() {
      return harvestPaused
    },
    syncNow() {
      const pending: Promise<unknown>[] = []
      for (const directory of new Set([...registeredDirectories(), ...jobs.keys()])) {
        const result = learn(directory)
        if (result instanceof Promise) pending.push(result)
        publish(directory)
      }
      return pending.length > 0 ? Promise.all(pending).then(() => ({ ran: true })) : { ran: true }
    },
    setLookup(next: AnswerLookup) {
      answer = next
    },
    sourceFolders() {
      return folders()
    },
    install(directory: string) {
      register(directory)
    },
    uninstall(directory: string) {
      unregister(directory)
      if (registeredDirectories().length === 0) unregisterLoginItem()
    },
    openWindow(directory: string) {
      const current = storedKnowledge(directory)
      const window = openApp(current, complete, machine, answer, cursorLookup)
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
