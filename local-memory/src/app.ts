import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteVault, readSecret, writeSecret } from './vault.ts'

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

export type Provider = 'anthropic' | 'openai'

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
  model: string
  learnerIntervalMs: number
  publisherIntervalMs: number
  drivePath: string
  disabledTools: string[]
  importedTranscripts: Record<string, string>
}

const emptyProfile = (): Profile => ({ username: '', email: '', team: '' })

const hourMs = 60 * 60 * 1000
const importBatchSize = 10

function requireAtLeastOneHour(intervalMs: number, job: string) {
  if (intervalMs < hourMs) throw new Error(`${job} interval must be at least one hour`)
}

const modelCatalog: Record<Provider, { models: string[]; defaultModel: string }> = {
  anthropic: {
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    defaultModel: 'claude-haiku-5-5',
  },
  openai: {
    models: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
    defaultModel: 'gpt-6-luna',
  },
}

function settingsPath(directory: string) {
  return join(directory, 'settings.json')
}

function emptySettings(): Settings {
  return {
    profile: emptyProfile(),
    vaultId: '',
    keys: [],
    model: '',
    learnerIntervalMs: hourMs,
    publisherIntervalMs: hourMs,
    drivePath: '',
    disabledTools: [],
    importedTranscripts: {},
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
      model: parsed.model ?? defaults.model,
      learnerIntervalMs: parsed.learnerIntervalMs ?? defaults.learnerIntervalMs,
      publisherIntervalMs: parsed.publisherIntervalMs ?? defaults.publisherIntervalMs,
      drivePath: parsed.drivePath ?? defaults.drivePath,
      disabledTools: parsed.disabledTools ?? defaults.disabledTools,
      importedTranscripts: parsed.importedTranscripts ?? defaults.importedTranscripts,
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
) {
  const settings = readSettings(directory)
  function offeredModels() {
    const active = settings.keys.find((key) => key.active)
    return active ? modelCatalog[active.provider].models : []
  }
  function profileIsComplete() {
    return [settings.profile.username, settings.profile.email, settings.profile.team].every(
      (field) => field.trim() !== '',
    )
  }
  function chosenModel() {
    if (offeredModels().includes(settings.model)) return settings.model
    const active = settings.keys.find((key) => key.active)
    if (!active) throw new Error('No model')
    return modelCatalog[active.provider].defaultModel
  }
  function refreshDiscovery() {
    if (!settings.keys.some((key) => key.active)) return
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
    saveKey(input: { provider: Provider; secret: string }) {
      if (!settings.vaultId) settings.vaultId = randomUUID()
      const id = randomUUID()
      writeSecret(settings.vaultId, id, input.secret)
      settings.keys.push({
        id,
        provider: input.provider,
        active: settings.keys.every((key) => !key.active),
      })
      writeSettings(directory, settings)
      refreshDiscovery()
    },
    activateKey(id: string) {
      const match = settings.keys.find((key) => key.id === id)
      if (!match) throw new Error(`No key ${id}`)
      for (const key of settings.keys) key.active = key.id === id
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
    runLearner(transcripts: Transcript[] = []) {
      const activeKey = settings.keys.some((key) => key.active)
      if (!profileIsComplete() || !activeKey) return { ran: false }
      const model = chosenModel()
      const enabled = new Set<string>(
        listedTools()
          .filter((tool) => tool.enabled)
          .map((tool) => tool.id),
      )
      const readable = newestFirst(
        transcripts.filter(
          (transcript) =>
            enabled.has(transcript.source) &&
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
    openApp(directory, complete, machine).runLearner(readTranscripts())
  }

  function publish(directory: string) {
    openApp(directory, complete, machine).runPublisher()
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

  function registeredDirectories() {
    try {
      const parsed = JSON.parse(readFileSync(registryPath(), 'utf8')) as { directories?: unknown }
      return Array.isArray(parsed.directories)
        ? parsed.directories.filter((directory): directory is string => typeof directory === 'string')
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  function writeRegistry(directories: string[]) {
    mkdirSync(join(machine.home, '.sharlie'), { recursive: true })
    writeFileSync(registryPath(), JSON.stringify({ directories }))
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
      const window = openApp(directory, complete, machine)
      return {
        ...window,
        registerJobs() {
          register(directory)
        },
        unregisterJobs() {
          unregister(directory)
        },
        close() {},
      }
    },
  }
}
