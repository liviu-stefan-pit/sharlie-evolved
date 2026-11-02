import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  onLearning,
  openApp,
  openUserSession,
  readInstalledTranscripts,
  renderLookup,
  type CompleteLesson,
  type LessonDraft,
  type Machine,
  type Transcript,
} from './app.ts'
import { callModel, listCopilotModels, type ExchangeDeps } from './exchange.ts'
import { mergeSynapseConfig } from './mcp.ts'
import { openDesktopHost } from './window.ts'

type Post = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

function limitWords(text: string, max = 120) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, max).join(' ')
}

function sentences(text: string, count: number) {
  const parts = text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const chosen = parts.slice(0, count)
  if (chosen.length === 0) return ''
  return chosen.join(' ')
}

export function lessonFromModel(text: string): LessonDraft {
  const match = text.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(match ? match[0] : text) as Partial<LessonDraft>
  const solution = typeof parsed.solution === 'string' ? parsed.solution : typeof parsed.whatToDo === 'string' ? parsed.whatToDo : ''
  const failure = Array.isArray(parsed.failure_modes)
    ? parsed.failure_modes.filter((mode): mode is string => typeof mode === 'string')
    : typeof parsed.situation === 'string' && parsed.situation !== ''
      ? [parsed.situation]
      : []
  const whatToDo = limitWords(typeof parsed.whatToDo === 'string' && parsed.whatToDo !== '' ? parsed.whatToDo : solution)
  const situation = limitWords(
    typeof parsed.situation === 'string' && parsed.situation !== '' ? parsed.situation : failure.join(' '),
  )
  const summarySource = typeof parsed.summary === 'string' && parsed.summary !== '' ? parsed.summary : solution
  const summary = sentences(summarySource, 2) || sentences(`${summarySource}.`, 1)
  return {
    scope: parsed.scope === 'personal' ? 'personal' : 'work',
    title: typeof parsed.title === 'string' ? parsed.title : '',
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter((topic): topic is string => typeof topic === 'string') : ['lesson'],
    summary,
    situation,
    whatToDo,
    why: limitWords(typeof parsed.why === 'string' && parsed.why !== '' ? parsed.why : 'The card records what worked.'),
    apply: limitWords(typeof parsed.apply === 'string' && parsed.apply !== '' ? parsed.apply : whatToDo),
    otherNames: Array.isArray(parsed.otherNames)
      ? parsed.otherNames.filter((name): name is string => typeof name === 'string')
      : [],
    belongsToProject: typeof parsed.belongsToProject === 'string' ? parsed.belongsToProject : null,
    clearlyOneProduct: parsed.clearlyOneProduct === true,
    subjectProject: typeof parsed.subjectProject === 'string' ? parsed.subjectProject : null,
    generalTechnique: parsed.generalTechnique === true,
    sources: Array.isArray(parsed.sources) ? parsed.sources.filter((source): source is string => typeof source === 'string') : undefined,
    sameClaim: parsed.sameClaim === true,
    updateId: typeof parsed.updateId === 'string' && parsed.updateId !== '' ? parsed.updateId : undefined,
    solution,
    failure_modes: failure,
    context: parsed.context,
    relations: Array.isArray(parsed.relations) ? parsed.relations : undefined,
  }
}

function cardPrompt(request: Parameters<CompleteLesson>[0]) {
  return [
    'Do not edit any files. Reply with one JSON object and no markdown fences.',
    'The object is one lesson card. Include title, context with os, tool_version, and framework, solution, failure_modes, relations as {entity, relation, target_entity}, and sources.',
    'Also include scope (personal or work), topics, summary (one or two sentences), situation, whatToDo, why, apply, otherNames, belongsToProject, clearlyOneProduct, subjectProject, generalTechnique, sameClaim, and updateId.',
    'Keep each of situation, whatToDo, why, and apply within 120 words.',
    'Keep the person\'s username, email, and team. Put every other person\'s name only in otherNames, not in the title, the lesson text, or the topics.',
    'The title is one short lesson claim in plain words, like "Retry failed deploys". Never a file name, path, task id, or chat recap.',
    'Topics are short shared labels, never file names.',
    'Relations use only APPLIES_TO, OCCURS_IN, INCOMPATIBLE_WITH, WARNS_AGAINST, RESOLVES. target_entity is a project or tool, never a path.',
    'Sources are only the transcript tool, not Read, Shell, or other tool-call names.',
    'A repeated claim sets sameClaim true or updateId to the known card id. A different claim leaves updateId empty. A second tool is added to sources.',
    '',
    `Model: ${request.model}`,
    `Source: ${request.transcript.source}`,
    `Repo: ${request.transcript.repo ?? ''}`,
    `Workspace: ${request.transcript.workspace ?? ''}`,
    'Known cards:',
    ...request.cards.map((card) => `${card.id} ${card.title} ${card.sources.join(',')}`),
    '',
    'Transcript:',
    request.transcript.text,
  ].join('\n')
}

async function ensureCopilotModels(directory: string, fetchImpl?: Post, machine?: Machine) {
  const app = openApp(directory, undefined, machine)
  let key: ReturnType<typeof app.activeKey>
  try {
    key = app.activeKey()
  } catch {
    return app
  }
  if (key.provider !== 'copilot' || app.modelsFor('copilot').length > 0) return app
  try {
    const models = await listCopilotModels(key.secret, fetchImpl)
    app.rememberCopilot({ models })
  } catch {
    // The saved key is still used with the model id already chosen.
  }
  return app
}

let mockModelCalls = 0

/** Counts lessons the smoke mock wrote. A normal launch never increments this. */
export function mockModelCallCount() {
  return mockModelCalls
}

export function resetMockModelCalls() {
  mockModelCalls = 0
}

/** The mock model answers only when the packaged smoke asked for it. The env var alone does nothing. */
export function mockModelEnabled() {
  return process.argv.includes('--smoke') && process.env.SHARLIE_MOCK_MODEL === '1'
}

function mockLesson(request: Parameters<CompleteLesson>[0]): LessonDraft {
  mockModelCalls += 1
  return {
    scope: 'work',
    title: 'Retry the deploy once',
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: request.transcript.text,
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    otherNames: [],
    belongsToProject: null,
    clearlyOneProduct: true,
    subjectProject: null,
    generalTechnique: false,
  }
}

export function desktopLesson(
  directory: () => string,
  fetchImpl?: Post,
  deps: ExchangeDeps = {},
  machine?: Machine,
  mockModel = false,
): CompleteLesson {
  if (mockModel) {
    return async (request) => mockLesson(request)
  }
  return async (request) => {
    const folder = directory()
    const app = await ensureCopilotModels(folder, fetchImpl, machine)
    const key = app.activeKey()
    const model = request.model || app.chosenModel()
    try {
      const replied = await callModel(
        {
          provider: key.provider,
          secret: key.secret,
          model,
          params: key.provider === 'cursor' ? app.modelParams() : undefined,
          prompt: cardPrompt({ ...request, model }),
          baseUrl: app.customBaseUrl(),
          chatCompletions: key.provider === 'copilot' ? app.copilotChat(model) : undefined,
          cwd: folder,
        },
        fetchImpl,
        deps,
      )
      const text = typeof replied === 'string' ? replied : replied.text
      const tokens = typeof replied === 'string' ? null : replied.tokens
      app.addLearningTokens(tokens)
      return lessonFromModel(text)
    } catch (error) {
      app.addLearningTokens(null)
      throw error
    }
  }
}

export function startHarvestTimer(session: { pass: (ms: number) => void; harvestPaused: () => boolean }, stepMs = 1000) {
  return setInterval(() => {
    if (!session.harvestPaused()) session.pass(stepMs)
  }, stepMs)
}

export async function openDesktopHarness(options: {
  person: string
  directory: string
  machine?: Machine
  readTranscripts?: () => Transcript[]
  fetchImpl?: Post
  deps?: ExchangeDeps
  mockModel?: boolean
}) {
  let session: ReturnType<typeof openUserSession>
  session = openUserSession(
    options.person,
    desktopLesson(
      () => session.knowledgeDirectory(options.directory),
      options.fetchImpl,
      options.deps,
      options.machine,
      options.mockModel === true,
    ),
    options.machine,
    options.readTranscripts ?? (() => (options.machine ? readInstalledTranscripts(options.machine) : readInstalledTranscripts())),
  )
  await ensureCopilotModels(session.knowledgeDirectory(options.directory), options.fetchImpl, options.machine)
  session.setLookup(async (turn) => {
    const folder = session.knowledgeDirectory(options.directory)
    const app = openApp(folder, undefined, options.machine)
    const key = app.activeKey()
    const replied = await callModel(
      {
        provider: key.provider,
        secret: key.secret,
        model: turn.model,
        params: key.provider === 'cursor' ? app.modelParams() : undefined,
        prompt: renderLookup(turn),
        baseUrl: app.customBaseUrl(),
        chatCompletions: key.provider === 'copilot' ? app.copilotChat(turn.model) : undefined,
        cwd: folder,
      },
      options.fetchImpl,
      options.deps,
    )
    const text = typeof replied === 'string' ? replied : replied.text
    return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text) as { pick: string[] } | { answer: string }
  })
  session.logIn()
  if (options.machine) mergeSynapseConfig(options.machine)
  const timer = startHarvestTimer(session)
  return { session, timer }
}

export async function openRunningDesktopHost(options?: {
  onLearning?: () => void
  machine?: Machine
  directory?: string
  mockModel?: boolean
}) {
  const directory = options?.directory ?? join(homedir(), '.sharlie', 'knowledge')
  const machine = options?.machine
  const harness = await openDesktopHarness({
    person: userInfo().username,
    directory,
    machine,
    mockModel: options?.mockModel,
    readTranscripts: () => (machine ? readInstalledTranscripts(machine) : readInstalledTranscripts()),
  })
  mergeSynapseConfig()
  const host = await openDesktopHost({
    directory,
    session: harness.session,
  })
  const stopLearning = onLearning(() => {
    options?.onLearning?.()
  })
  return {
    line: (input: string) => host.line(input),
    close: () => {
      stopLearning()
      clearInterval(harness.timer)
    },
  }
}
