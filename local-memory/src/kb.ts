/**
 * Shared team knowledge base on a plain folder, including a Google Drive
 * for Desktop path. There is no Drive API and no sign-in.
 *
 * Each app reads the folder, then writes only its own lesson files. Links
 * are stored on the lesson being written. This module never rewrites another
 * writer's file and never keeps a shared index file.
 *
 * readIndex(folder) -> KbNode[]
 *   Work lessons already in the folder. Unreadable, partial, malformed, and
 *   foreign files are skipped. Never throws. Every node has synced: true
 *   and the writer slug taken from its id.
 *
 * suggestLinks(lesson, index) -> KbLink[]
 *   Up to 8 existing nodes that share a topic, a project, or a title word.
 *   The same inputs always return the same links. No model call.
 *
 * newInstallId() -> string
 *   Four characters from a-z and 0-9. The app stores one of these per install.
 *
 * writerId(name, installId) -> string
 *   `<name-slug>-<installId>`, for example ada-lovelace-k3f9. Two people
 *   with the same display name and different install ids get different ids.
 *   A name that slugifies to nothing, such as 李雷, becomes user-<installId>.
 *   Returns "" when installId is not four characters from a-z and 0-9.
 *
 * writeLesson(folder, writer, lesson, index) -> Promise<{ ok: true, lesson } | { ok: false, reason }>
 *   `writer` is a writerId, not the display name. Writes `<writer>-<uuid>.json`
 *   and the matching `.md` when scope is exactly "work", with links filled
 *   from suggestLinks. A missing scope is personal and is not written. A
 *   missing or read-only folder returns a reason and does not throw. The
 *   bytes land by renaming a temp file in the same folder. A rewrite is
 *   refused when the file on disk has a different author email, or when its
 *   id does not start with this writer id.
 *
 * listWriters(folder) -> string[]
 *   Sorted writer ids from readIndex. Never throws.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type KbAuthor = {
  username: string
  email: string
  team: string
}

export type KbLink = {
  id: string
  writer: string
}

export type KbLessonInput = {
  id?: string
  title: string
  topics?: string[]
  summary?: string
  situation?: string
  whatToDo?: string
  why?: string
  apply?: string
  scope?: string
  author: KbAuthor
  project?: string
  created_at?: string
  sources?: string[]
}

export type KbNode = {
  id: string
  title: string
  topics: string[]
  summary: string
  situation: string
  whatToDo: string
  why: string
  apply: string
  scope: 'work'
  author: KbAuthor
  project: string
  created_at: string
  sources: string[]
  links: KbLink[]
  writer: string
  synced: true
}

export type KbWriteResult = { ok: true; lesson: KbNode; unchanged?: boolean } | { ok: false; reason: string }

const linkCap = 8
const maxLessonBytes = 2_000_000
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const idPattern = new RegExp(`^([a-z0-9]+(?:-[a-z0-9]+)*)-(${uuidPattern})$`)
const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'before',
  'but',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'once',
  'or',
  'our',
  'so',
  'than',
  'that',
  'the',
  'then',
  'this',
  'to',
  'when',
  'with',
  'you',
  'your',
])

type LessonRecord = Omit<KbNode, 'writer' | 'synced'>

function compareText(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

function refuse(reason: string): KbWriteResult {
  return { ok: false, reason }
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringList(value: unknown, foldCase: boolean) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed === '') continue
    const key = foldCase ? trimmed.toLowerCase() : trimmed
    if (seen.has(key)) continue
    seen.add(key)
    items.push(trimmed)
  }
  return items
}

function writerSlug(name: string) {
  const slug = name
    .trim()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug
}

const installAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function newInstallId() {
  const bytes = randomBytes(4)
  let id = ''
  for (const byte of bytes) id += installAlphabet[byte % installAlphabet.length]
  return id
}

export function writerId(name: string, installId: string) {
  const install = text(installId).toLowerCase()
  if (!/^[a-z0-9]{4}$/.test(install)) return ''
  const slug = writerSlug(text(name))
  return `${slug === '' ? 'user' : slug}-${install}`
}

function isWriterId(writer: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(writer)) return false
  const parts = writer.split('-')
  const install = parts[parts.length - 1] ?? ''
  return parts.length >= 2 && install.length === 4
}

function parseId(id: string) {
  const match = idPattern.exec(id)
  if (!match) return null
  return { writer: match[1] }
}

function authorFrom(value: unknown): KbAuthor {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    username: text(raw.username),
    email: text(raw.email),
    team: text(raw.team),
  }
}

function linksFrom(value: unknown): KbLink[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const links: KbLink[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const id = text(record.id)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    links.push({ id, writer: text(record.writer) })
  }
  return links
}

function isLessonName(name: string) {
  if (name.startsWith('.')) return false
  if (name.endsWith('.tmp') || name.endsWith('.partial')) return false
  if (!name.endsWith('.json')) return false
  return parseId(name.slice(0, -'.json'.length)) !== null
}

function toNode(value: unknown, fileId: string): KbNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const owner = parseId(fileId)
  if (!owner) return null
  if (raw.id !== fileId) return null
  if (typeof raw.title !== 'string' || raw.title.trim() === '') return null
  if (raw.scope !== 'work') return null
  return {
    id: fileId,
    title: raw.title.trim(),
    topics: stringList(raw.topics, true),
    summary: text(raw.summary),
    situation: text(raw.situation),
    whatToDo: text(raw.whatToDo),
    why: text(raw.why),
    apply: text(raw.apply),
    scope: 'work',
    author: authorFrom(raw.author),
    project: text(raw.project),
    created_at: text(raw.created_at),
    sources: stringList(raw.sources, false),
    links: linksFrom(raw.links),
    writer: owner.writer,
    synced: true,
  }
}

function readLessonFile(folder: string, name: string): KbNode | null {
  if (!isLessonName(name)) return null
  const path = join(folder, name)
  const info = statSync(path)
  if (!info.isFile() || info.size === 0 || info.size > maxLessonBytes) return null
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return toNode(parsed, name.slice(0, -'.json'.length))
}

export function readIndex(folder: string): KbNode[] {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return []
  }
  const nodes: KbNode[] = []
  for (const name of names) {
    try {
      const node = readLessonFile(folder, name)
      if (node) nodes.push(node)
    } catch {
      continue
    }
  }
  nodes.sort((left, right) => compareText(left.id, right.id))
  return nodes
}

export function listWriters(folder: string): string[] {
  try {
    const writers = new Set<string>()
    for (const node of readIndex(folder)) {
      if (node.writer !== '') writers.add(node.writer)
    }
    return [...writers].sort(compareText)
  } catch {
    return []
  }
}

function titleTokens(title: string) {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const token of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 3 || stopWords.has(token) || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

function projectKey(project: string) {
  const key = project.trim().toLowerCase()
  if (key === '' || key === 'none') return ''
  return key
}

export function suggestLinks(lesson: KbLessonInput, index: readonly KbNode[]): KbLink[] {
  const draft: KbLessonInput =
    lesson && typeof lesson === 'object' ? lesson : { title: '', author: { username: '', email: '', team: '' } }
  const nodes = Array.isArray(index) ? index : []
  const topics = new Set(stringList(draft.topics, true).map((topic) => topic.toLowerCase()))
  const project = projectKey(text(draft.project))
  const tokens = new Set(titleTokens(text(draft.title)))
  const ownId = text(draft.id)
  const ranked: { score: number; id: string; writer: string }[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    if (typeof node.id !== 'string' || node.id === '' || node.id === ownId) continue
    const writer = text(node.writer) || parseId(node.id)?.writer || ''
    if (writer === '') continue
    let score = 0
    const nodeTopics = new Set(stringList(node.topics, true).map((topic) => topic.toLowerCase()))
    for (const topic of topics) {
      if (nodeTopics.has(topic)) score += 3
    }
    const nodeProject = projectKey(text(node.project))
    if (project !== '' && nodeProject === project) score += 2
    let sharedWords = 0
    for (const token of titleTokens(text(node.title))) {
      if (tokens.has(token)) sharedWords += 1
    }
    score += sharedWords
    if (score > 0) ranked.push({ score, id: node.id, writer })
  }
  ranked.sort((left, right) => right.score - left.score || compareText(left.id, right.id))
  return ranked.slice(0, linkCap).map((item) => ({ id: item.id, writer: item.writer }))
}

function yaml(value: string) {
  if (/[:#[\]{}&*!|>%`"'\n\r,]|^\s|\s$|^[-?]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return value
}

function renderMarkdown(lesson: LessonRecord) {
  const topics = lesson.topics.length > 0 ? ['topics:', ...lesson.topics.map((topic) => `  - ${yaml(topic)}`)] : ['topics: []']
  const sources =
    lesson.sources.length > 0 ? ['sources:', ...lesson.sources.map((source) => `  - ${yaml(source)}`)] : ['sources: []']
  const links =
    lesson.links.length > 0
      ? ['links:', ...lesson.links.flatMap((link) => [`  - id: ${yaml(link.id)}`, `    writer: ${yaml(link.writer)}`])]
      : ['links: []']
  return [
    '---',
    `id: ${lesson.id}`,
    'scope: work',
    `title: ${yaml(lesson.title)}`,
    ...topics,
    `summary: ${yaml(lesson.summary)}`,
    `situation: ${yaml(lesson.situation)}`,
    `whatToDo: ${yaml(lesson.whatToDo)}`,
    `why: ${yaml(lesson.why)}`,
    `apply: ${yaml(lesson.apply)}`,
    `project: ${yaml(lesson.project)}`,
    `created_at: ${lesson.created_at}`,
    'author:',
    `  username: ${yaml(lesson.author.username)}`,
    `  email: ${yaml(lesson.author.email)}`,
    `  team: ${yaml(lesson.author.team)}`,
    ...sources,
    ...links,
    '---',
    '',
    '## Summary',
    '',
    lesson.summary,
    '',
    '## Situation',
    '',
    lesson.situation,
    '',
    '## What to do',
    '',
    lesson.whatToDo,
    '',
    '## Why',
    '',
    lesson.why,
    '',
    '## Apply',
    '',
    lesson.apply,
    '',
  ].join('\n')
}

const tempMaxAgeMs = 10 * 60 * 1000

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function sweepOldTemps(folder: string, writer: string) {
  const cutoff = Date.now() - tempMaxAgeMs
  const tempName = new RegExp(
    `^\\.${escapeRegExp(writer)}-${uuidPattern}\\.(?:json|md)\\.\\d+\\.[0-9a-f]{12}\\.tmp$`,
  )
  const orphanNote = new RegExp(`^${escapeRegExp(writer)}-${uuidPattern}\\.md$`)
  let names: string[] = []
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  const present = new Set(names)
  for (const name of names) {
    const staleTemp = tempName.test(name)
    const orphan = orphanNote.test(name) && !present.has(`${name.slice(0, -'.md'.length)}.json`)
    if (!staleTemp && !orphan) continue
    const path = join(folder, name)
    try {
      const info = statSync(path)
      if (!info.isFile() || info.mtimeMs >= cutoff) continue
      await rm(path, { force: true })
    } catch {
      // A file that cannot be removed stays where it is.
    }
  }
}

function sha256(body: string | Buffer) {
  return createHash('sha256').update(body).digest('hex')
}

async function sameBytes(path: string, body: string) {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size !== Buffer.byteLength(body)) return false
    return sha256(readFileSync(path)) === sha256(body)
  } catch {
    return false
  }
}

async function discardTemp(path: string) {
  const name = basename(path)
  if (!name.startsWith('.') || !name.endsWith('.tmp')) return
  await rm(path, { force: true }).catch(() => undefined)
}

type SaveHooks = {
  rename: (from: string, to: string) => Promise<void>
  wait: (ms: number) => Promise<void>
}

const defaultSaveHooks: SaveHooks = {
  rename: (from, to) => rename(from, to),
  wait: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms)
    }),
}

let saveHooks: SaveHooks = defaultSaveHooks

/** Test hook. Pass null to restore the real rename and the real wait. */
export function setKbSaveHooksForTests(hooks: Partial<SaveHooks> | null) {
  saveHooks = hooks ? { ...defaultSaveHooks, ...hooks } : defaultSaveHooks
}

function saveFailure(reason: string) {
  const error = new Error(reason) as Error & { reason: string }
  error.reason = reason
  return error
}

function failureReason(error: unknown) {
  if (error && typeof error === 'object' && 'reason' in error && typeof error.reason === 'string') return error.reason
  return ''
}

async function placeFile(folder: string, name: string, body: string) {
  const dest = join(folder, name)
  const tmp = join(folder, `.${name}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await writeFile(tmp, body, { encoding: 'utf8', flag: 'wx' })
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await saveHooks.rename(tmp, dest)
        return
      } catch (error) {
        const code = errorCode(error)
        if (code !== 'EEXIST' && code !== 'EPERM') throw error
        if (attempt === 5) break
        await saveHooks.wait(200)
      }
    }
    throw saveFailure('could not finish saving the lesson')
  } catch (error) {
    await discardTemp(tmp)
    throw error
  }
}

async function fileExists(path: string) {
  try {
    const info = await stat(path)
    if (info.isDirectory()) return 'directory' as const
    return 'file' as const
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'missing' as const
    throw error
  }
}

function scopeReason(scope: string | undefined) {
  if (scope === 'personal') return 'personal lessons stay on this computer'
  if (scope === undefined) return 'a lesson with no scope is personal and stays on this computer'
  return 'only a lesson scoped work is written to the shared folder'
}

function readStoredLesson(path: string) {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    const owner = parseId(text(record.id))
    return {
      email: authorFrom(record.author).email,
      writer: owner?.writer ?? '',
      createdAt: text(record.created_at),
    }
  } catch {
    return null
  }
}

export async function writeLesson(
  folder: string,
  writer: string,
  lesson: KbLessonInput,
  index: readonly KbNode[],
): Promise<KbWriteResult> {
  if (!lesson || typeof lesson !== 'object') return refuse('the lesson is missing')
  if (lesson.scope !== 'work') return refuse(scopeReason(lesson.scope))
  const author = authorFrom(lesson.author)
  const writerKey = text(writer).toLowerCase()
  if (!isWriterId(writerKey)) return refuse('the writer id is not valid')
  const title = text(lesson.title)
  if (title === '') return refuse('a lesson needs a title')
  if (typeof folder !== 'string' || folder.trim() === '') return refuse('that folder does not exist')

  let id = text(lesson.id)
  if (id === '') id = `${writerKey}-${randomUUID()}`
  const owner = parseId(id)
  if (!owner || owner.writer !== writerKey) return refuse('a writer can only write its own lesson id')

  try {
    const folderInfo = await stat(folder)
    if (!folderInfo.isDirectory()) return refuse('that path is not a folder')
    const links = suggestLinks({ ...lesson, id, title, topics: lesson.topics, project: lesson.project }, index)
    let createdAt = text(lesson.created_at)
    const jsonName = `${id}.json`
    const jsonState = await fileExists(join(folder, jsonName))
    if (jsonState === 'directory') return refuse('that path is not a folder')
    if (jsonState === 'file') {
      const previous = readStoredLesson(join(folder, jsonName))
      if (!previous) return refuse('that lesson file could not be read')
      if (previous.email.toLowerCase() !== author.email.toLowerCase()) {
        return refuse('that lesson belongs to a different email')
      }
      if (previous.writer !== writerKey) return refuse('that lesson belongs to a different writer')
      if (createdAt === '' && previous.createdAt !== '') createdAt = previous.createdAt
    }
    if (createdAt === '') createdAt = new Date().toISOString()
    const record: LessonRecord = {
      id,
      title,
      topics: stringList(lesson.topics, true),
      summary: text(lesson.summary),
      situation: text(lesson.situation),
      whatToDo: text(lesson.whatToDo),
      why: text(lesson.why),
      apply: text(lesson.apply),
      scope: 'work',
      author,
      project: text(lesson.project),
      created_at: createdAt,
      sources: stringList(lesson.sources, false),
      links,
    }
    const body = `${JSON.stringify(record, null, 2)}\n`
    const markdownName = `${id}.md`
    const markdown = renderMarkdown(record)
    const markdownState = await fileExists(join(folder, markdownName))
    if (markdownState === 'directory') return refuse('that path is not a folder')
    if (
      jsonState === 'file' &&
      markdownState === 'file' &&
      (await sameBytes(join(folder, jsonName), body)) &&
      (await sameBytes(join(folder, markdownName), markdown))
    ) {
      return { ok: true, lesson: { ...record, writer: writerKey, synced: true }, unchanged: true }
    }
    await sweepOldTemps(folder, writerKey)
    await placeFile(folder, markdownName, markdown)
    await placeFile(folder, jsonName, body)
    return { ok: true, lesson: { ...record, writer: writerKey, synced: true } }
  } catch (error) {
    const reason = failureReason(error)
    if (reason !== '') return refuse(reason)
    const code = errorCode(error)
    if (code === 'ENOENT') return refuse('that folder does not exist')
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOTDIR') {
      return refuse('that folder is not writable')
    }
    if (code === 'EEXIST') return refuse('that lesson file is already there')
    return refuse('could not write the lesson')
  }
}
