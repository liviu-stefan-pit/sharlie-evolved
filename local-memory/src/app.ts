import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, posix, relative, win32 } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { registerLoginItem, unregisterLoginItem } from './login-item.ts'
import { isFileMention, isLearningSource } from './graph-rules.ts'
import { localGraph, publishCard, readCards, type CardRelation } from './synapse.ts'
import {
  catalogParameters,
  catalogVariants,
  defaultParams,
  parseSavedParams,
  resolveParams,
  type CatalogParameter,
  type CatalogVariant,
  type ModelParameterValue,
} from './catalog.ts'
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
  params?: ModelParameterValue[]
  baseUrl?: string
  chatCompletions?: boolean
  cwd?: string
}

export type ModelReply = { text: string; tokens: number | null }

export type ModelExchange = (request: ModelRequest) => string | ModelReply | Promise<string | ModelReply>

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
  parameters?: CatalogParameter[]
  variants?: CatalogVariant[]
}

export type CursorAccount = {
  models: ListedModel[]
  expiresAt?: string
  error?: string
}

export type CursorLookup = (secret: string) => Promise<CursorAccount>

export type ToolId = 'cursor' | 'copilot' | 'claude' | 'cursor-cli' | 'claude-cli' | 'copilot-cli'

export type SourceFolder = { tool: string; path: string; chats: number }

export type SearchedFolder = { tool: string; path: string }

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
  modelParams: ModelParameterValue[]
  learnerIntervalMs: number
  publisherIntervalMs: number
  drivePath: string
  disabledTools: string[]
  learningStarted: boolean
  initialIngestComplete: boolean
  learningTokens: number
  learningTokensUnreported: number
  importedTranscripts: Record<string, string>
  cursorModels: ListedModel[]
  copilotModels: ListedModel[]
  cursorKey: { expiresAt: string; error: string }
  selectedProvider: Provider | ''
  customBaseUrl: string
  customModel: string
  autoDrop: boolean
}

const emptyProfile = (): Profile => ({ username: '', email: '', team: '' })

const hourMs = 60 * 60 * 1000
const thirtyMin = 30 * 60 * 1000
const importBatchSize = 10

export type LearningProgress = {
  active: boolean
  done: number
  total: number
  lessons?: number
  error?: string
  /** Plain sentence for the window, such as "Reading Cursor chats". */
  label?: string
  /** Developer detail: source, file, and card title. */
  detail?: string
}

export type LearningResult = {
  lessons: number
  chats: number
  text: string
}

export type IngestLog = {
  lines: string[]
  tokens: number
  unreported: number
}

export type IngestView = {
  visible: true
  lines: string[]
  tokens: number
  unreported: number
}

let learningSnapshot: LearningProgress | null = null
let learningGeneration = 0
let cancelledGeneration = 0
let learningOutcome: LearningResult | null = null
const learningListeners = new Set<(progress: LearningProgress) => void>()
let lessonWriteQueue: Promise<void> = Promise.resolve()

export function learningProgress(): LearningProgress | null {
  return learningSnapshot
}

export function learningResult(): LearningResult | null {
  return learningOutcome
}

/** Stop the current foreground pass before the next card write. Cards already written stay. */
export function cancelLearning() {
  if (!learningSnapshot?.active) return
  const lessons = learningSnapshot.lessons ?? 0
  const chats = learningSnapshot.done
  const total = learningSnapshot.total
  cancelledGeneration = learningGeneration
  learningOutcome = {
    lessons,
    chats,
    text: `Learning cancelled · ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'} learned`,
  }
  learningSnapshot = null
  const notice: LearningProgress = { active: false, done: chats, total }
  for (const listener of [...learningListeners]) listener(notice)
}

export function onLearning(listener: (progress: LearningProgress) => void): () => void {
  learningListeners.add(listener)
  return () => {
    learningListeners.delete(listener)
  }
}

function emitLearning(progress: LearningProgress) {
  learningSnapshot = progress
  for (const listener of [...learningListeners]) listener(progress)
}

function startForeground(total: number) {
  learningGeneration += 1
  learningOutcome = null
  learningSnapshot = { active: true, done: 0, total, lessons: 0 }
  return learningGeneration
}

function finishEmptyForeground() {
  startForeground(0)
  emitLearning({ active: false, done: 0, total: 0 })
}

function learningErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function noteForeground(generation: number, error?: string) {
  if (generation !== learningGeneration || !learningSnapshot || !learningSnapshot.active) return
  const done = learningSnapshot.done + 1
  const total = learningSnapshot.total
  const message = error ?? learningSnapshot.error
  const next: LearningProgress = { active: true, done, total }
  if (typeof learningSnapshot.lessons === 'number') next.lessons = learningSnapshot.lessons
  if (learningSnapshot.label) next.label = learningSnapshot.label
  if (learningSnapshot.detail) next.detail = learningSnapshot.detail
  if (message) next.error = message
  learningSnapshot = next
}

function isMissingKeySecret(error: unknown) {
  return error instanceof Error && error.message.startsWith('No secret stored for key ')
}

function enqueueLessonWrite(write: () => void): Promise<void> {
  const finished = lessonWriteQueue.then(write)
  lessonWriteQueue = finished.then(
    () => undefined,
    () => undefined,
  )
  return finished
}

const fifteenMin = 15 * 60 * 1000

function requireInterval(intervalMs: number, job: string) {
  if (intervalMs !== 0 && intervalMs !== fifteenMin && intervalMs !== thirtyMin && intervalMs !== hourMs) {
    throw new Error(`${job} interval must be 15 minutes, 30 minutes, 1 hour, or manual`)
  }
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

function cursorKeyInfo(value: unknown): { expiresAt: string; error: string } {
  const record = value && typeof value === 'object' ? (value as { expiresAt?: unknown; error?: unknown }) : {}
  const text = (item: unknown) => (typeof item === 'string' ? item : '')
  return { expiresAt: text(record.expiresAt), error: text(record.error) }
}

function listedModels(value: unknown): ListedModel[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { id?: unknown; displayName?: unknown }
    if (typeof record.id !== 'string' || record.id === '') return []
    const displayName = typeof record.displayName === 'string' && record.displayName !== '' ? record.displayName : record.id
    const chatCompletions = (record as { chatCompletions?: unknown }).chatCompletions
    const parameters = catalogParameters((record as { parameters?: unknown }).parameters)
    const variants = catalogVariants((record as { variants?: unknown }).variants)
    return [
      {
        id: record.id,
        displayName,
        ...(chatCompletions === false ? { chatCompletions: false as const } : {}),
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(variants.length > 0 ? { variants } : {}),
      },
    ]
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
  let expiresAt = ''
  try {
    const response = await fetchImpl('https://api.cursor.com/v1/me', { headers })
    if (response.ok) {
      const body = (await response.json()) as {
        expiresAt?: unknown
        apiKeyExpiresAt?: unknown
        apiKeyExpiresAtMs?: unknown
      }
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
  return { models, expiresAt, error }
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
    modelParams: [],
    learnerIntervalMs: thirtyMin,
    publisherIntervalMs: thirtyMin,
    drivePath: '',
    disabledTools: [],
    learningStarted: false,
    initialIngestComplete: false,
    learningTokens: 0,
    learningTokensUnreported: 0,
    importedTranscripts: {},
    cursorModels: [],
    copilotModels: [],
    cursorKey: { expiresAt: '', error: '' },
    selectedProvider: '',
    customBaseUrl: '',
    customModel: '',
    autoDrop: false,
  }
}

function hasPublishedCards(directory: string) {
  const folder = join(directory, 'cards')
  if (!existsSync(folder)) return false
  return readdirSync(folder).some((name) => name.startsWith('card_') && name.endsWith('.json'))
}

function countOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Comments and trailing commas are ignored. A file that still will not parse is moved aside. */
function settingsText(text: string) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[i + 1] === '/') {
      i += 1
      while (i + 1 < text.length && text[i + 1] !== '\n') i += 1
      continue
    }
    if (char === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += char
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

function quarantineSettings(file: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try {
    renameSync(file, `${file}.${stamp}.bak`)
  } catch {
    // The unreadable file stays where it is. Defaults still load.
  }
}

function readSettings(directory: string): Settings {
  const file = settingsPath(directory)
  try {
    const text = readFileSync(file, 'utf8')
    let parsed: Settings
    try {
      parsed = JSON.parse(settingsText(text)) as Settings
    } catch {
      quarantineSettings(file)
      return emptySettings()
    }
    const defaults = emptySettings()
    return {
      profile: { ...defaults.profile, ...parsed.profile },
      vaultId: parsed.vaultId ?? defaults.vaultId,
      keys: parsed.keys ?? defaults.keys,
      pinnedKeyId: parsed.pinnedKeyId ?? defaults.pinnedKeyId,
      model: parsed.model ?? defaults.model,
      modelParams: parseSavedParams(parsed.modelParams),
      learnerIntervalMs: parsed.learnerIntervalMs ?? defaults.learnerIntervalMs,
      publisherIntervalMs: parsed.publisherIntervalMs ?? defaults.publisherIntervalMs,
      drivePath: parsed.drivePath ?? defaults.drivePath,
      disabledTools: parsed.disabledTools ?? defaults.disabledTools,
      learningStarted: parsed.learningStarted ?? defaults.learningStarted,
      initialIngestComplete:
        typeof parsed.initialIngestComplete === 'boolean'
          ? parsed.initialIngestComplete
          : hasPublishedCards(directory),
      learningTokens: countOrZero(parsed.learningTokens),
      learningTokensUnreported: countOrZero(parsed.learningTokensUnreported),
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

function writeSettings(
  directory: string,
  settings: Settings,
  options?: { replaceImported?: boolean; tokens?: boolean },
) {
  const current = readSettings(directory)
  const merged: Settings = {
    ...settings,
    importedTranscripts: options?.replaceImported
      ? { ...settings.importedTranscripts }
      : { ...current.importedTranscripts, ...settings.importedTranscripts },
    learningTokens: options?.tokens ? settings.learningTokens : current.learningTokens,
    learningTokensUnreported: options?.tokens ? settings.learningTokensUnreported : current.learningTokensUnreported,
  }
  mkdirSync(directory, { recursive: true })
  writeAtomic(settingsPath(directory), JSON.stringify(merged))
}

function writeAtomic(file: string, text: string) {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, text)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function ingestLogPath(directory: string) {
  return join(directory, 'ingest-log.json')
}

const ingestLogLines = 300

function emptyIngestLog(): IngestLog {
  return { lines: [], tokens: 0, unreported: 0 }
}

function readIngestLog(directory: string): IngestLog {
  try {
    const parsed = JSON.parse(readFileSync(ingestLogPath(directory), 'utf8')) as {
      lines?: unknown
      tokens?: unknown
      unreported?: unknown
    }
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines.filter((line): line is string => typeof line === 'string')
      : []
    return {
      lines,
      tokens: countOrZero(parsed.tokens),
      unreported: countOrZero(parsed.unreported),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIngestLog()
    throw error
  }
}

function writeIngestLog(directory: string, log: IngestLog) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(ingestLogPath(directory), JSON.stringify(log))
}

function appendIngestLines(
  directory: string,
  lines: string[],
  totals?: { tokens: number; unreported: number },
) {
  if (lines.length === 0 && !totals) return
  const log = readIngestLog(directory)
  log.lines = [...log.lines, ...lines].slice(-ingestLogLines)
  if (totals) {
    log.tokens = totals.tokens
    log.unreported = totals.unreported
  }
  writeIngestLog(directory, log)
}

function appendIngestLine(
  directory: string,
  line: string,
  totals?: { tokens: number; unreported: number },
) {
  appendIngestLines(directory, [line], totals)
}

function ingestChatLine(transcript: Transcript, suffix: string) {
  return `${transcript.source} · ${transcriptLabel(transcript)} · ${suffix}`
}

function readingLabel(source: string) {
  const name =
    source === 'cursor' || source === 'cursor-cli'
      ? 'Cursor'
      : source === 'copilot' || source === 'copilot-cli'
        ? 'Copilot'
        : source === 'claude' || source === 'claude-cli'
          ? 'Claude'
          : source
  return `Reading ${name} chats`
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

const closedRelations = new Set([
  'APPLIES_TO',
  'OCCURS_IN',
  'INCOMPATIBLE_WITH',
  'WARNS_AGAINST',
  'RESOLVES',
])

function lessonIsComplete(lesson: LessonDraft, source: string) {
  return (
    (lesson.scope === 'personal' || lesson.scope === 'work') &&
    filled(source) &&
    filled(lesson.title) &&
    !isFileMention(lesson.title) &&
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
    const project = card.context?.framework
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
  const stored: StoredCard[] = []
  for (const card of readCards(directory)) {
    try {
      if (!card || typeof card.id !== 'string' || card.id === '') continue
      if (!card.context || typeof card.context !== 'object') continue
      if (!card.author || typeof card.author !== 'object') continue
      const topics = Array.isArray(card.topics) ? card.topics : []
      const modes = Array.isArray(card.failure_modes) ? card.failure_modes : []
      const sources = Array.isArray(card.sources) ? card.sources : []
      stored.push({
        path: join(directory, 'cards', `${card.id}.md`),
        id: card.id,
        at: typeof card.created_at === 'string' ? card.created_at : '',
        author: card.author,
        sources,
        project: card.context.framework || 'none',
        title: typeof card.title === 'string' ? card.title : '',
        topics: topics
          .filter((topic): topic is string => typeof topic === 'string')
          .map((topic) => topic.trim())
          .filter((topic) => topic !== '' && !isFileMention(topic)),
        summary: typeof card.title === 'string' ? card.title : '',
        situation: typeof modes[0] === 'string' ? modes[0] : '',
        whatToDo: typeof card.solution === 'string' ? card.solution : '',
        why: typeof modes[1] === 'string' ? modes[1] : '',
        apply: typeof modes[2] === 'string' ? modes[2] : '',
      })
    } catch {
      continue
    }
  }
  return stored
}

function transcriptKey(transcript: Transcript) {
  if (transcript.id) return transcript.id
  return createHash('sha256')
    .update(`${transcript.source}\0${transcript.text}\0${transcript.repo ?? ''}\0${transcript.workspace ?? ''}`)
    .digest('hex')
}

function transcriptLabel(transcript: Transcript) {
  const id = transcript.id?.trim() ?? ''
  if (id === '') return transcriptKey(transcript)
  return basename(id)
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

function blobUtf8(data: unknown) {
  if (typeof data === 'string') return data
  if (data instanceof Uint8Array) return new TextDecoder().decode(data)
  return ''
}

function textsFromCliStore(file: string) {
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    const rows = db.prepare('SELECT data FROM blobs ORDER BY rowid').all() as { data?: unknown }[]
    const parts: string[] = []
    for (const row of rows) {
      try {
        const text = lineText(JSON.parse(blobUtf8(row.data)) as unknown)
        if (text) parts.push(text)
      } catch {
        continue
      }
    }
    return parts.join('\n')
  } catch {
    return ''
  } finally {
    try {
      db?.close()
    } catch {
      /* keep Windows from holding the temp file */
    }
  }
}

function readCliMeta(file: string) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      cwd?: unknown
      hasConversation?: unknown
      updatedAtMs?: unknown
    }
    return {
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
      hasConversation: parsed.hasConversation === true,
      updatedAtMs: typeof parsed.updatedAtMs === 'number' ? parsed.updatedAtMs : Number.NaN,
    }
  } catch {
    return { cwd: '', hasConversation: false, updatedAtMs: Number.NaN }
  }
}

function listCursorCliSessions(chats: string) {
  const sessions: { id: string; dir: string }[] = []
  for (const hash of directoryNames(chats)) {
    for (const id of directoryNames(join(chats, hash))) {
      sessions.push({ id, dir: join(chats, hash, id) })
    }
  }
  return sessions
}

function agentSessionFiles(projects: string, sessionId: string) {
  const parent: string[] = []
  const subagents: string[] = []
  for (const project of directoryNames(projects)) {
    const sessionDir = join(projects, project, 'agent-transcripts', sessionId)
    const parentFile = join(sessionDir, `${sessionId}.jsonl`)
    if (isFile(parentFile)) parent.push(parentFile)
    const nested = join(sessionDir, 'subagents')
    if (!isDirectory(nested)) continue
    try {
      for (const entry of readdirSync(nested, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) subagents.push(join(nested, entry.name))
      }
    } catch {
      continue
    }
  }
  return { parent, subagents }
}

function cursorProjectRepo(machine: Machine, projectDir: string) {
  const decoded = decodeCursorSlug(machine, projectDir)
  return decoded ? baseName(decoded) : projectDir || undefined
}

function transcriptFromCursorAgent(machine: Machine, file: string, projects: string): Transcript | null {
  const transcript = transcriptFromFile(file, 'cursor', projects)
  if (!transcript) return null
  const projectDir = relative(projects, file).split(/[/\\]/)[0]
  if (projectDir) transcript.repo = cursorProjectRepo(machine, projectDir)
  return transcript
}

function planFiles(root: string) {
  if (!isDirectory(root)) return []
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.plan.md'))
      .map((entry) => join(root, entry.name))
  } catch {
    return []
  }
}

function transcriptFromPlan(file: string): Transcript | null {
  let text = ''
  try {
    text = readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
  if (!text) return null
  return {
    id: file,
    source: 'cursor',
    text,
    changedAt: statSync(file).mtime.toISOString(),
  }
}

function collectInstalledSources(machine: Machine) {
  const installed = new Set(scanTools(machine).map((tool) => tool.id))
  const folders: SourceFolder[] = []
  const searched: SearchedFolder[] = []
  const counts = new Map<string, number>()
  const marked = new Set<string>()
  const seen = new Set<string>()
  const transcripts: Transcript[] = []
  const projects = join(machine.home, '.cursor', 'projects')
  const plans = join(machine.home, '.cursor', 'plans')
  const chats = join(machine.home, '.cursor', 'chats')
  const claudeProjects = join(machine.home, '.claude', 'projects')
  const copilotUser = join(roamingAppData(machine), 'Code', 'User')
  const copilotStorage = join(copilotUser, 'workspaceStorage')
  const copilotEmpty = join(copilotUser, 'globalStorage', 'emptyWindowChatSessions')
  const claudeSessions = join(roamingAppData(machine), 'Claude', 'local-agent-mode-sessions')
  const copilotCliState = join(machine.home, '.copilot', 'session-state')

  function mark(tool: string, path: string, chats = 1) {
    if (!isDirectory(path) || chats <= 0) return
    const key = `${tool}\0${pathKey(machine, path)}`
    marked.add(key)
    counts.set(key, (counts.get(key) ?? 0) + chats)
  }

  function emit(tool: string, path: string) {
    searched.push({ tool, path })
    const key = `${tool}\0${pathKey(machine, path)}`
    const chats = counts.get(key) ?? 0
    if (chats > 0) folders.push({ tool, path, chats })
  }

  function walk(tool: string, files: string[], read: (file: string) => Transcript | null, menu: string | null) {
    let produced = 0
    for (const file of files) {
      if (seen.has(file)) continue
      seen.add(file)
      const transcript = read(file)
      if (!transcript) continue
      transcripts.push(transcript)
      produced++
    }
    if (produced > 0 && menu) mark(tool, menu, produced)
  }

  if (installed.has('cursor-cli')) {
    for (const session of listCursorCliSessions(chats)) {
      const meta = readCliMeta(join(session.dir, 'meta.json'))
      const store = join(session.dir, 'store.db')
      const hasStore = isFile(store)
      if (!meta.hasConversation && !hasStore) continue
      const mirrored = agentSessionFiles(projects, session.id)
      let text = ''
      let id = store
      let changedAt = ''
      if (hasStore) {
        text = textsFromCliStore(store)
        changedAt = statSync(store).mtime.toISOString()
      }
      if (!text) {
        for (const file of mirrored.parent) {
          const fallback = transcriptFromFile(file, 'cursor-cli', projects)
          if (!fallback) continue
          text = fallback.text
          id = file
          changedAt = fallback.changedAt ?? ''
          break
        }
      }
      if (text) {
        for (const file of mirrored.parent) seen.add(file)
        if (Number.isFinite(meta.updatedAtMs)) changedAt = new Date(meta.updatedAtMs).toISOString()
        transcripts.push({
          id,
          source: 'cursor-cli',
          text,
          repo: baseName(meta.cwd),
          changedAt: changedAt || undefined,
        })
        mark('Cursor CLI', chats)
      }
      for (const file of mirrored.subagents) {
        if (seen.has(file)) continue
        seen.add(file)
        const transcript = transcriptFromFile(file, 'cursor-cli', projects)
        if (!transcript) continue
        if (meta.cwd) transcript.repo = baseName(meta.cwd)
        transcripts.push(transcript)
        mark('Cursor CLI', chats)
      }
    }
  }

  if (installed.has('cursor')) {
    const agentFiles = jsonlFiles(projects).filter((file) => file.split(/[/\\]/).includes('agent-transcripts'))
    walk('Cursor', agentFiles, (file) => transcriptFromCursorAgent(machine, file, projects), projects)
    walk('Cursor', planFiles(plans), transcriptFromPlan, plans)
  }

  if (installed.has('claude-cli')) {
    walk('Claude CLI', jsonlFiles(claudeProjects), (file) => transcriptFromFile(file, 'claude-cli', claudeProjects), claudeProjects)
  }

  if (installed.has('copilot')) {
    const accept = (name: string) => name.endsWith('.jsonl') || name.endsWith('.json')
    for (const id of directoryNames(copilotStorage)) {
      const home = join(copilotStorage, id)
      const repo = baseName(folderFromWorkspaceJson(join(home, 'workspace.json')))
      const sessions = join(home, 'chatSessions')
      const transcriptsFolder = join(home, 'GitHub.copilot-chat', 'transcripts')
      walk(
        'Copilot in VS Code',
        namedFiles(sessions, accept, true),
        (file) => transcriptFromChatFile(file, 'copilot', sessions, repo),
        copilotStorage,
      )
      walk(
        'Copilot in VS Code',
        namedFiles(transcriptsFolder, accept, true),
        (file) => transcriptFromChatFile(file, 'copilot', transcriptsFolder, repo),
        copilotStorage,
      )
    }
    walk(
      'Copilot in VS Code',
      namedFiles(copilotEmpty, accept, true),
      (file) => transcriptFromChatFile(file, 'copilot', copilotEmpty),
      copilotEmpty,
    )
  }

  if (installed.has('claude')) {
    walk('Claude', sessionJsonl(claudeSessions), (file) => transcriptFromFile(file, 'claude', claudeSessions), claudeSessions)
    if (!installed.has('claude-cli')) {
      walk('Claude', jsonlFiles(claudeProjects), (file) => transcriptFromFile(file, 'claude', claudeProjects), claudeProjects)
    }
  }

  if (installed.has('copilot-cli')) {
    walk(
      'Copilot CLI',
      copilotCliFiles(copilotCliState),
      (file) => transcriptFromChatFile(file, 'copilot-cli', copilotCliState),
      copilotCliState,
    )
  }

  for (const root of workspaceNoteRoots(machine)) {
    walk('Workspace notes', noteFiles(root), (file) => transcriptFromNote(file, root), null)
  }

  emit('Cursor', projects)
  emit('Cursor', plans)
  emit('Cursor CLI', chats)
  emit('Claude CLI', claudeProjects)
  emit('Copilot in VS Code', copilotStorage)
  emit('Copilot in VS Code', copilotEmpty)
  emit('Claude', claudeSessions)
  if (!installed.has('claude-cli')) emit('Claude', claudeProjects)
  emit('Copilot CLI', copilotCliState)

  return { folders, searched, transcripts }
}

export function sourceFolders(machine: Machine = thisMachine()): SourceFolder[] {
  return collectInstalledSources(machine).folders
}

export function searchedFolders(machine: Machine = thisMachine()): SearchedFolder[] {
  return collectInstalledSources(machine).searched
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
    const replied = await exchange({
      provider: key.provider,
      secret: key.secret,
      model: turn.model,
      prompt: renderLookup(turn),
      baseUrl,
      chatCompletions: key.provider === 'copilot' ? stored.copilotChat(turn.model) : undefined,
      cwd: directory,
    })
    const text = typeof replied === 'string' ? replied : replied.text
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
    if (!settings.selectedProvider) return undefined
    const matches = settings.keys.filter((key) => key.provider === settings.selectedProvider)
    if (matches.length === 0) return undefined
    return matches.find((key) => key.id === settings.pinnedKeyId) ?? matches[matches.length - 1]
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
    if (!settings.keys.some((key) => key.active)) throw new Error('No model')
    if (offeredModels().includes(settings.model)) return settings.model
    return ''
  }
  function syncModel() {
    const active = settings.keys.find((key) => key.active)
    if (!active) {
      settings.model = ''
      settings.modelParams = []
      return
    }
    const offered = modelChoices(active.provider)
    const ids = offered.map((model) => model.id)
    if (!ids.includes(settings.model)) {
      settings.model =
        active.provider === 'anthropic' || active.provider === 'openai' ? modelCatalog[active.provider].defaultModel : ''
      settings.modelParams = []
    }
    if (active.provider === 'cursor' && settings.model !== '') {
      const choice = offered.find((model) => model.id === settings.model)
      settings.modelParams = choice ? resolveParams(choice, settings.modelParams) : []
    } else if (active.provider !== 'cursor') {
      settings.modelParams = []
    }
  }
  function paramsReady() {
    const active = settings.keys.find((key) => key.active)
    if (active?.provider !== 'cursor') return true
    const choice = modelChoices('cursor').find((model) => model.id === settings.model)
    const required = (choice?.parameters ?? []).filter((parameter) => parameter.values.length > 0)
    return required.every((parameter) =>
      settings.modelParams.some(
        (item) => item.id === parameter.id && parameter.values.some((value) => value.value === item.value),
      ),
    )
  }
  function refreshDiscovery() {
    if (!offeredModels().includes(settings.model)) return
    writeDiscoverySkills(machine, directory, settings.model)
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
      const hadAnyKey = settings.keys.length > 0
      const id = randomUUID()
      writeSecret(settings.vaultId, id, input.secret)
      const previous = settings.keys.filter((key) => key.provider === input.provider)
      for (const key of previous) {
        try {
          deleteSecret(settings.vaultId, key.id)
        } catch {
          // The vault entry is already gone.
        }
      }
      if (previous.some((key) => key.id === settings.pinnedKeyId)) settings.pinnedKeyId = ''
      settings.keys = settings.keys.filter((key) => key.provider !== input.provider)
      settings.keys.push({ id, provider: input.provider, active: false })
      if (!hadAnyKey) {
        settings.selectedProvider = input.provider
        settings.pinnedKeyId = id
      } else if (settings.selectedProvider === input.provider) {
        settings.pinnedKeyId = id
      }
      const chosen = chosenKey()
      for (const key of settings.keys) key.active = chosen ? key.id === chosen.id : false
      if (input.provider === 'cursor' && input.account) {
        settings.cursorModels = input.account.models
        settings.cursorKey = {
          expiresAt: input.account.expiresAt ?? '',
          error: input.account.error ?? '',
        }
      }
      if (input.provider === 'copilot' && input.account) {
        settings.copilotModels = input.account.models
      }
      if (input.provider === 'custom') {
        if (typeof input.baseUrl === 'string') settings.customBaseUrl = input.baseUrl
        if (typeof input.model === 'string' && input.model.trim() !== '') settings.customModel = input.model.trim()
      }
      syncModel()
      if (input.provider === 'custom' && typeof input.model === 'string' && input.model.trim() !== '' && settings.selectedProvider === 'custom') {
        settings.model = input.model.trim()
        settings.modelParams = []
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
          expiresAt: settings.cursorKey.expiresAt,
          error: account.error || 'Cursor model list failed',
        }
        writeSettings(directory, settings)
        return
      }
      settings.cursorModels = account.models
      settings.cursorKey = {
        expiresAt: account.expiresAt || settings.cursorKey.expiresAt,
        error: '',
      }
      syncModel()
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    rememberCopilot(account: CursorAccount) {
      if (account.models.length === 0) return
      settings.copilotModels = account.models
      syncModel()
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
      syncModel()
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    activateProvider(provider: Provider) {
      settings.selectedProvider = provider
      const matches = settings.keys.filter((key) => key.provider === provider)
      if (matches.length === 0) {
        settings.selectedProvider = ''
        settings.pinnedKeyId = ''
        for (const key of settings.keys) key.active = false
        settings.model = ''
        settings.modelParams = []
        writeSettings(directory, settings)
        return
      }
      const chosen = matches.find((key) => key.id === settings.pinnedKeyId) ?? matches[matches.length - 1]
      this.activateKey(chosen.id)
    },
    clearProvider() {
      settings.selectedProvider = ''
      settings.pinnedKeyId = ''
      for (const key of settings.keys) key.active = false
      settings.model = ''
      settings.modelParams = []
      writeSettings(directory, settings)
      refreshDiscovery()
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
        settings.cursorKey = { expiresAt: '', error: '' }
      }
      if (provider === 'copilot') settings.copilotModels = []
      if (provider === 'custom') {
        settings.customBaseUrl = ''
        settings.customModel = ''
      }
      if (settings.selectedProvider === provider) {
        settings.selectedProvider = ''
        settings.pinnedKeyId = ''
        for (const key of settings.keys) key.active = false
        settings.model = ''
        settings.modelParams = []
      } else {
        const chosen = chosenKey()
        for (const key of settings.keys) key.active = chosen ? key.id === chosen.id : false
        syncModel()
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
      const active = settings.keys.find((key) => key.active)
      if (active?.provider === 'cursor') {
        const choice = modelChoices('cursor').find((item) => item.id === model)
        settings.modelParams = choice ? defaultParams(choice) : []
      } else {
        settings.modelParams = []
      }
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    clearModel() {
      settings.model = ''
      settings.modelParams = []
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    setModelParam(id: string, value: string) {
      const active = settings.keys.find((key) => key.active)
      if (active?.provider !== 'cursor' || settings.model === '') throw new Error('No model')
      const choice = modelChoices('cursor').find((item) => item.id === settings.model)
      if (!choice) throw new Error('No model')
      settings.modelParams = resolveParams(choice, [
        ...settings.modelParams.filter((item) => item.id !== id),
        { id, value },
      ])
      writeSettings(directory, settings)
    },
    modelParams() {
      return settings.modelParams.map((item) => ({ ...item }))
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
    addLearningTokens(tokens: number | null) {
      const current = readSettings(directory)
      if (tokens == null) current.learningTokensUnreported += 1
      else current.learningTokens += tokens
      settings.learningTokens = current.learningTokens
      settings.learningTokensUnreported = current.learningTokensUnreported
      writeSettings(directory, current, { tokens: true })
      const log = readIngestLog(directory)
      if (log.lines.length > 0 || current.learningTokens > 0 || current.learningTokensUnreported > 0) {
        log.tokens = current.learningTokens
        log.unreported = current.learningTokensUnreported
        writeIngestLog(directory, log)
      }
    },
    learningTokens() {
      const current = readSettings(directory)
      settings.learningTokens = current.learningTokens
      settings.learningTokensUnreported = current.learningTokensUnreported
      return current.learningTokens
    },
    learningTokensUnreported() {
      const current = readSettings(directory)
      settings.learningTokens = current.learningTokens
      settings.learningTokensUnreported = current.learningTokensUnreported
      return current.learningTokensUnreported
    },
    initialIngestComplete() {
      return settings.initialIngestComplete
    },
    ingestLog() {
      return readIngestLog(directory)
    },
    ingestView(_nodeCount: number, _transcripts: Transcript[] = []): IngestView | null {
      const current = readSettings(directory)
      settings.learningTokens = current.learningTokens
      settings.learningTokensUnreported = current.learningTokensUnreported
      const log = readIngestLog(directory)
      if (settings.initialIngestComplete || log.lines.length === 0) return null
      return {
        visible: true,
        lines: log.lines,
        tokens: current.learningTokens,
        unreported: current.learningTokensUnreported,
      }
    },
    beginLearning(transcripts: Transcript[] = []) {
      if (!profileIsComplete()) {
        return 'Save your username, email, and team before learning can write cards.'
      }
      if (!settings.keys.some((key) => key.active)) {
        return 'Turn on a provider before learning can write cards.'
      }
      if (offeredModels().length === 0) {
        return 'This SDK has no model list. Switch to Anthropic or OpenAI to start learning.'
      }
      if (!offeredModels().includes(settings.model)) {
        return 'Choose a model before learning can write cards.'
      }
      if (!paramsReady()) {
        return 'Choose effort and fast mode before learning can write cards.'
      }
      settings.learningStarted = true
      writeSettings(directory, settings)
      const running = this.runLearner(transcripts, { foreground: true })
      if (running && typeof (running as Promise<unknown>).then === 'function') {
        Promise.resolve(running).catch((error: unknown) => {
          if (!learningSnapshot?.active) return
          emitLearning({
            active: false,
            done: learningSnapshot.done,
            total: learningSnapshot.total,
            error: learningErrorMessage(error),
          })
        })
      }
      return ''
    },
    runLearner(
      transcripts: Transcript[] = [],
      options?: { foreground?: boolean },
    ): { ran: false } | { ran: true; model: string } | Promise<{ ran: true; model: string }> {
      if (
        !profileIsComplete() ||
        !settings.keys.some((key) => key.active) ||
        !offeredModels().includes(settings.model) ||
        !paramsReady()
      ) {
        return { ran: false }
      }
      const model = settings.model
      const installed = new Set<string>(listedTools().map((tool) => tool.id))
      const readable = newestFirst(
        transcripts.filter(
          (transcript) =>
            (installed.has(transcript.source) || transcript.source === 'workspace') &&
            settings.importedTranscripts[transcriptKey(transcript)] !== transcriptRevision(transcript),
        ),
      )
      const foreground = options?.foreground === true
      const latestTotals = () => {
        const current = readSettings(directory)
        settings.learningTokens = current.learningTokens
        settings.learningTokensUnreported = current.learningTokensUnreported
        return current
      }
      const pendingIngest: { lines: string[]; totals?: { tokens: number; unreported: number } } = {
        lines: [],
      }
      const queueIngestLine = (
        line: string,
        totals?: { tokens: number; unreported: number },
        transcript?: Transcript,
      ) => {
        pendingIngest.lines.push(line)
        if (totals) pendingIngest.totals = totals
        if (transcript && learningSnapshot?.active) {
          learningSnapshot = {
            ...learningSnapshot,
            label: readingLabel(transcript.source),
            detail: line,
          }
        }
      }
      const flushIngest = () => {
        if (pendingIngest.lines.length > 0 || pendingIngest.totals) {
          appendIngestLines(directory, pendingIngest.lines, pendingIngest.totals)
          pendingIngest.lines = []
          pendingIngest.totals = undefined
        }
        if (!learningSnapshot) return
        emitLearning(learningSnapshot)
        if (!learningSnapshot.active || learningSnapshot.done !== learningSnapshot.total) return
        const finished: LearningProgress = {
          active: false,
          done: learningSnapshot.done,
          total: learningSnapshot.total,
        }
        if (learningSnapshot.error) finished.error = learningSnapshot.error
        emitLearning(finished)
      }
      const settleIngest = (
        transcript: Transcript,
        status: 'processed' | 'skipped' | 'failed',
        detail: string,
      ) => {
        if (!foreground) return
        const totals = latestTotals()
        const suffix =
          status === 'processed'
            ? `card "${detail}"`
            : status === 'skipped'
              ? `skipped · ${detail}`
              : `failed · ${detail}`
        queueIngestLine(
          ingestChatLine(transcript, suffix),
          {
            tokens: totals.learningTokens,
            unreported: totals.learningTokensUnreported,
          },
          transcript,
        )
      }
      const markIngestComplete = () => {
        settings.initialIngestComplete = true
        writeSettings(directory, settings)
      }
      if (readable.length === 0) {
        if (foreground) {
          finishEmptyForeground()
          markIngestComplete()
        }
        return { ran: true, model }
      }
      if (!complete) throw new Error('No model')
      const generation = foreground ? startForeground(readable.length) : 0
      const stopped = () => generation !== 0 && cancelledGeneration === generation
      const finishOk = () => {
        if (foreground && learningSnapshot && learningSnapshot.done === learningSnapshot.total) {
          markIngestComplete()
        }
        return { ran: true as const, model }
      }
      const failRun = (error: unknown): never => {
        if (foreground && learningSnapshot?.active && generation === learningGeneration) {
          emitLearning({
            active: false,
            done: learningSnapshot.done,
            total: learningSnapshot.total,
            error: learningErrorMessage(error),
          })
        }
        throw error
      }
      if (foreground) {
        queueIngestLine(`Found ${readable.length} transcript${readable.length === 1 ? '' : 's'}`)
      }
      try {
        this.activeKey()
      } catch (error) {
        if (foreground) {
          queueIngestLine(`failed · ${learningErrorMessage(error)}`)
          learningSnapshot = {
            active: false,
            done: 0,
            total: readable.length,
            error: learningErrorMessage(error),
          }
          flushIngest()
        }
        if (isMissingKeySecret(error)) return { ran: true, model }
        throw error
      }
      try {
        let chain: Promise<void> | undefined
        for (let start = 0; start < readable.length; start += importBatchSize) {
          const batch = readable.slice(start, start + importBatchSize)
          const work = () => {
            if (stopped()) return undefined
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
            if (foreground) {
              for (const { original } of prepared) {
                queueIngestLine(ingestChatLine(original, 'learning'), undefined, original)
              }
              flushIngest()
            }
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
            const writeOneLesson = (
              original: Transcript,
              transcript: Transcript,
              lesson: LessonDraft,
            ): { status: 'processed' | 'skipped'; detail: string } => {
              if (lesson.sameClaim) return { status: 'skipped', detail: 'already have this claim' }
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
                  .filter((topic) => filled(topic) && !isFileMention(topic)),
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
                      .filter(
                        (relation) =>
                          filled(relation.entity) &&
                          filled(relation.relation) &&
                          filled(relation.target_entity) &&
                          closedRelations.has(relation.relation) &&
                          !isFileMention(relation.target_entity),
                      )
                  : undefined,
              }
              const previous = lesson.updateId ? stored.find((card) => card.id === lesson.updateId) : undefined
              if (lesson.updateId && !previous) return { status: 'skipped', detail: 'update target missing' }
              const sources = [
                ...new Set(
                  [
                    ...(previous?.sources ?? []),
                    ...(Array.isArray(lesson.sources) && lesson.sources.length > 0
                      ? lesson.sources
                      : [transcript.source]),
                  ]
                    .map((source) => asText(source).trim())
                    .filter((source) => filled(source) && isLearningSource(source)),
                ),
              ]
              const transcriptSource = asText(transcript.source).trim()
              if (isLearningSource(transcriptSource) && !sources.includes(transcriptSource)) {
                sources.push(transcriptSource)
              }
              if (!lessonIsComplete(scrubbed, sources[0] ?? '')) return { status: 'skipped', detail: 'lesson incomplete' }
              const relations =
                scrubbed.relations && scrubbed.relations.length > 0
                  ? scrubbed.relations
                  : [
                      ...sources.map((source) => ({
                        entity: scrubbed.title,
                        relation: 'APPLIES_TO',
                        target_entity: source,
                      })),
                      ...(project !== 'none' && !isFileMention(project)
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
                  topics: scrubbed.topics,
                  context: {
                    os: scrubbed.context && filled(scrubbed.context.os) ? scrubbed.context.os : machine.platform,
                    tool_version:
                      scrubbed.context && filled(scrubbed.context.tool_version) ? scrubbed.context.tool_version : '',
                    framework: project,
                  },
                  solution: scrubbed.solution || scrubbed.whatToDo,
                  failure_modes: failureModes,
                  relations,
                  sources,
                  scope: scrubbed.scope,
                  author: { ...settings.profile },
                },
              })
              return { status: 'processed', detail: scrubbed.title }
            }
            const applyLesson = (original: Transcript, transcript: Transcript, lesson: LessonDraft) => {
              if (stopped()) return
              try {
                const outcome = writeOneLesson(original, transcript, lesson)
                settings.importedTranscripts[transcriptKey(original)] = transcriptRevision(original)
                writeSettings(directory, settings)
                settleIngest(original, outcome.status, outcome.detail)
                if (
                  foreground &&
                  outcome.status === 'processed' &&
                  learningSnapshot?.active &&
                  generation === learningGeneration
                ) {
                  learningSnapshot = { ...learningSnapshot, lessons: (learningSnapshot.lessons ?? 0) + 1 }
                }
                if (foreground) noteForeground(generation)
              } catch (error) {
                const message = learningErrorMessage(error)
                settleIngest(original, 'failed', message)
                if (foreground) {
                  noteForeground(generation, message)
                  return
                }
                throw error
              }
            }
            const applyFailure = (original: Transcript, transcript: Transcript, error: unknown) => {
              const message = learningErrorMessage(error)
              settleIngest(original, 'failed', message)
              if (foreground) noteForeground(generation, message)
              else throw error
            }
            if (lessons.some((item) => item.lesson instanceof Promise)) {
              let unsettled = lessons.length
              const enqueueSettle = (write: () => void) =>
                enqueueLessonWrite(() => {
                  try {
                    write()
                  } finally {
                    unsettled -= 1
                    if (unsettled === 0) flushIngest()
                  }
                })
              return Promise.all(
                lessons.map((item) =>
                  Promise.resolve(item.lesson).then(
                    (lesson) => enqueueSettle(() => applyLesson(item.original, item.transcript, lesson)),
                    (error: unknown) => enqueueSettle(() => applyFailure(item.original, item.transcript, error)),
                  ),
                ),
              ).then(() => undefined)
            }
            for (const item of lessons) {
              applyLesson(item.original, item.transcript, item.lesson as LessonDraft)
            }
            if (foreground) flushIngest()
            return undefined
          }
          if (chain) {
            chain = chain.then(work)
          } else {
            const result = work()
            if (result) chain = result
          }
        }
        if (chain) return chain.then(finishOk, failRun)
        return finishOk()
      } catch (error) {
        throw failRun(error)
      }
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
      if (!settings.autoDrop) return { ran: false }
      if (settings.drivePath.trim() === '') return { ran: false }
      const username = settings.profile.username.trim()
      if (username === '') return { ran: false }
      const cardsDir = join(directory, 'cards')
      const names = existsSync(cardsDir)
        ? readdirSync(cardsDir).filter((name) => name !== '.claims.json' && name.endsWith('.json'))
        : []
      const workStems: string[] = []
      for (const name of names) {
        try {
          const parsed = JSON.parse(readFileSync(join(cardsDir, name), 'utf8')) as { scope?: unknown }
          if (parsed?.scope === 'work') workStems.push(name.slice(0, -'.json'.length))
        } catch {
          // A file that is not a work card stays on this PC.
        }
      }
      if (workStems.length === 0) return { ran: true }
      const dest = join(settings.drivePath, 'Dropzone', username)
      mkdirSync(dest, { recursive: true })
      for (const stem of workStems) {
        for (const ext of ['.json', '.md'] as const) {
          const from = join(cardsDir, `${stem}${ext}`)
          if (!existsSync(from)) continue
          copyFileSync(from, join(dest, `${stem}${ext}`))
        }
      }
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
      if (kind === 'team') {
        const matched = cards.filter((card) => card.author.team === key)
        if (matched.length === 0) throw new Error(`No node ${id}`)
        return { kind: 'team' as const, name: key, cards: titles(matched) }
      }
      if (kind === 'topic') {
        const matched = cards.filter((card) => card.topics.includes(key))
        if (matched.length === 0) throw new Error(`No node ${id}`)
        return { kind: 'topic' as const, name: key, cards: titles(matched) }
      }
      const named = (name: string, matched: typeof cards) => {
        if (matched.length === 0) throw new Error(`No node ${id}`)
        return { kind: kind as 'tool' | 'issue' | 'antipattern', name, cards: titles(matched) }
      }
      const linked = cards.filter(
        (card) =>
          card.sources.includes(key) ||
          (kind === 'issue' && card.context?.framework === key) ||
          card.relations.some((relation) => relation.target_entity === key),
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
  const searched = () => searchedFolders(machine)

  function scheduled(directory: string) {
    const existing = jobs.get(directory)
    if (existing) return existing
    const created: ScheduledJobs = { learnerDue: null, publisherDue: null }
    jobs.set(directory, created)
    return created
  }

  function learn(directory: string) {
    const current = readSettings(directory)
    if (!current.learningStarted) return
    if (!current.initialIngestComplete) return
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
    searchedFolders() {
      return searched()
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
        recentTranscripts() {
          return readTranscripts()
        },
        startLearning() {
          const found = folders().reduce((sum, source) => sum + source.chats, 0)
          if (found === 0) {
            return 'No AI coding chats were found. Sharlie looks in Cursor, Copilot, and Claude.'
          }
          return window.beginLearning(readTranscripts())
        },
        setKnowledgePath(path: string) {
          const next = path.trim()
          if (next === '') throw new Error('knowledge path is required')
          if (next === current) return
          mkdirSync(next, { recursive: true })
          if (!hasPublishedCards(next)) {
            const previousSettings = join(current, 'settings.json')
            const nextSettings = join(next, 'settings.json')
            if (existsSync(previousSettings) && !existsSync(nextSettings)) {
              copyFileSync(previousSettings, nextSettings)
            }
            const dest = readSettings(next)
            dest.importedTranscripts = {}
            dest.learningStarted = false
            dest.initialIngestComplete = false
            dest.learningTokens = 0
            dest.learningTokensUnreported = 0
            writeSettings(next, dest, { replaceImported: true, tokens: true })
            writeIngestLog(next, emptyIngestLog())
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
