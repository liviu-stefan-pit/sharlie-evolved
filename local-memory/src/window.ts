import { rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cancelLearning, learningProgress, learningResult, openUserSession, type Provider } from './app.ts'
import { listCopilotModels, listCursorCatalog } from './exchange.ts'
import { mockModelEnabled } from './host.ts'
import { runningUnderTest } from './login-item.ts'
import { localGraph } from './synapse.ts'
import { TEAM_SHARING_AVAILABLE } from './team-sharing.ts'

const require = createRequire(import.meta.url)

const hourMs = 60 * 60 * 1000

type Session = ReturnType<typeof openUserSession>
type WindowApp = ReturnType<Session['openWindow']>

export type ActionResult = { notice: string; errorCode?: string; detail?: string }

const knownActions = new Set([
  'save-profile',
  'save-key',
  'revoke-key',
  'activate-key',
  'activate-provider',
  'clear-provider',
  'set-cadence',
  'set-auto-drop',
  'set-base-url',
  'register',
  'unregister',
  'close',
  'set-learner-interval',
  'set-publisher-interval',
  'set-drive',
  'set-knowledge',
  'set-share',
  'pick-folder',
  'start-learning',
  'cancel-learning',
  'recheck-sources',
  'select-model',
  'set-model-param',
])

const providerName: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  cursor: 'Cursor',
}

type KeyProbe = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>

let keyProbe: KeyProbe | null = null

/** Test hook. A 401 or 403 rejects the key. A throw or any other failure still saves it. */
export function setKeyProbe(probe: KeyProbe | null) {
  keyProbe = probe
}

type FolderPicker = (purpose: 'knowledge' | 'share') => Promise<string | null> | string | null

let folderPicker: FolderPicker | null = null

/** Test hook. Returning null is the same as cancelling the folder dialog. */
export function setFolderPicker(picker: FolderPicker | null) {
  folderPicker = picker
}

function checkFolder(path: string): ActionResult | null {
  const trimmed = path.trim()
  if (trimmed === '') return refused('path_empty', 'Choose a folder.')
  let info: ReturnType<typeof statSync>
  try {
    info = statSync(trimmed)
  } catch {
    return refused('path_not_found', 'That folder does not exist.')
  }
  if (!info.isDirectory()) return refused('path_not_directory', 'That path is a file, not a folder.')
  const probe = join(trimmed, `.sharlie-write-${process.pid}`)
  try {
    writeFileSync(probe, '')
    rmSync(probe, { force: true })
  } catch {
    return refused('path_not_writable', 'Sharlie cannot write to that folder.')
  }
  return null
}

async function chooseFolder(purpose: 'knowledge' | 'share'): Promise<string | null> {
  if (folderPicker) {
    const chosen = await folderPicker(purpose)
    return chosen && chosen.trim() !== '' ? chosen : null
  }
  try {
    const loaded = require('electron') as
      | { dialog?: { showOpenDialog: (options: { properties: string[] }) => Promise<{ canceled: boolean; filePaths: string[] }> } }
      | string
    if (typeof loaded === 'string' || typeof loaded.dialog?.showOpenDialog !== 'function') return null
    const result = await loaded.dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  } catch {
    return null
  }
}

function applyShare(app: WindowApp, params: URLSearchParams): ActionResult {
  if (!TEAM_SHARING_AVAILABLE) {
    return refused('share_unavailable', 'Team sharing is not available in this version.')
  }
  const enabled = params.get('enabled') === 'true'
  if (!enabled) {
    app.setAutoDrop(false)
    return ok()
  }
  const incoming = params.get('path')
  if (incoming != null && incoming.trim() !== '') {
    const problem = checkFolder(incoming)
    if (problem) return problem
    app.setDrivePath(incoming.trim())
  }
  const drive = app.drivePath().trim()
  if (drive === '' || checkFolder(drive)) {
    return refused('share_needs_path', 'Choose a team Drive folder before sharing.')
  }
  app.setAutoDrop(true)
  return ok()
}

function ok(): ActionResult {
  return { notice: '' }
}

function refused(errorCode: string, notice: string, detail?: string): ActionResult {
  return detail === undefined ? { notice, errorCode } : { notice, errorCode, detail }
}

async function judgeKey(provider: 'anthropic' | 'openai' | 'cursor', secret: string) {
  const probe = keyProbe
  if (mockModelEnabled()) return 'ok' as const
  if (!probe && runningUnderTest()) return 'ok' as const
  const fetchImpl = probe ?? (fetch as unknown as KeyProbe)
  const url =
    provider === 'anthropic'
      ? 'https://api.anthropic.com/v1/models'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/models'
        : 'https://api.cursor.com/v1/models'
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': secret, 'anthropic-version': '2023-06-01', accept: 'application/json' }
      : { authorization: `Bearer ${secret}`, accept: 'application/json' }
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8000) })
    if (response.status === 401 || response.status === 403) return 'rejected' as const
    if (!response.ok) return 'unchecked' as const
    return 'ok' as const
  } catch {
    return 'unchecked' as const
  }
}

function rejection(provider: string): ActionResult {
  const label = providerName[provider] ?? provider
  return refused('key_rejected', `That key was rejected by ${label}. Check it and try again`)
}

function unchecked(provider: string): ActionResult {
  const label = providerName[provider] ?? provider
  return refused('key_unchecked', `The key was saved. Sharlie could not reach ${label} to check it.`)
}

const keyProviders: { id: Provider; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'custom', label: 'Custom' },
]

async function saveKey(app: WindowApp, params: URLSearchParams): Promise<ActionResult> {
  const secret = params.get('secret') ?? ''
  const provider = params.get('provider')
  if (
    secret.trim() === '' ||
    (provider !== 'cursor' && provider !== 'copilot' && provider !== 'anthropic' && provider !== 'openai' && provider !== 'custom')
  ) {
    return ok()
  }
  if (provider === 'custom') {
    app.saveKey({
      provider,
      secret,
      baseUrl: params.get('baseUrl') ?? '',
      model: params.get('model') ?? '',
    })
    return ok()
  }
  if (provider === 'anthropic' || provider === 'openai') {
    const verdict = await judgeKey(provider, secret)
    if (verdict === 'rejected') return rejection(provider)
    app.saveKey({ provider, secret })
    return verdict === 'unchecked' ? unchecked(provider) : ok()
  }
  if (provider === 'cursor') {
    const verdict = await judgeKey('cursor', secret)
    if (verdict === 'rejected') return rejection('cursor')
    let account
    try {
      account = await app.lookupCursor(secret)
    } catch (error) {
      account = { models: [], error: error instanceof Error ? error.message : 'Cursor model list failed' }
    }
    if (!runningUnderTest()) {
      try {
        const catalog = await listCursorCatalog(secret)
        if (catalog.length > 0) account = { ...account, models: catalog, error: '' }
      } catch {
        // The REST model list remains when the SDK catalog is unavailable.
      }
    }
    if (verdict === 'unchecked') {
      app.saveKey(account.models.length > 0 ? { provider, secret, account } : { provider, secret })
      return unchecked('cursor')
    }
    if (account.models.length === 0) return { notice: account.error || 'Cursor model list failed' }
    app.saveKey({ provider, secret, account })
    return ok()
  }
  if (provider === 'copilot') {
    let models: Awaited<ReturnType<typeof listCopilotModels>> | undefined
    if (!runningUnderTest()) {
      try {
        models = await listCopilotModels(secret)
      } catch {
        models = undefined
      }
    }
    app.saveKey(models ? { provider, secret, account: { models } } : { provider, secret })
    return ok()
  }
  app.saveKey({ provider, secret })
  return ok()
}

function mapStart(sentence: string): ActionResult {
  if (sentence === '') return ok()
  if (sentence.startsWith('Save your username')) return refused('profile_incomplete', sentence)
  if (sentence.startsWith('Turn on a provider')) return refused('key_missing', sentence)
  if (sentence.startsWith('Choose a model')) return refused('model_missing', sentence)
  if (sentence.startsWith('No AI coding chats')) return refused('no_chats', sentence)
  return { notice: sentence }
}

function applyWindow(app: WindowApp, params: URLSearchParams): ActionResult | Promise<ActionResult> {
  const action = params.get('action') ?? ''
  if (!knownActions.has(action)) {
    return refused('unknown_action', 'That action is not available.')
  }
  if (action === 'save-profile') {
    app.saveProfile({
      username: params.get('username') ?? '',
      email: params.get('email') ?? '',
      team: params.get('team') ?? '',
    })
  }
  if (action === 'save-key') {
    return saveKey(app, params)
  }
  if (action === 'revoke-key') {
    const provider = params.get('provider')
    if (provider === 'cursor' || provider === 'copilot' || provider === 'anthropic' || provider === 'openai' || provider === 'custom') {
      app.revokeProvider(provider)
    }
  }
  if (action === 'activate-key') {
    const id = params.get('id') ?? ''
    if (id !== '') app.activateKey(id)
  }
  if (action === 'activate-provider') {
    const provider = params.get('provider')
    if (provider === 'cursor' || provider === 'copilot' || provider === 'anthropic' || provider === 'openai' || provider === 'custom') {
      app.activateProvider(provider)
    }
  }
  if (action === 'clear-provider') app.clearProvider()
  if (action === 'set-cadence') {
    const cadence = params.get('cadence')
    if (cadence === '15m' || cadence === '30m') {
      return refused('cadence_too_short', 'The schedule cannot be shorter than 1 hour.')
    }
    if (cadence === '1h' || cadence === 'manual') app.setCadence(cadence)
  }
  if (action === 'set-auto-drop' || action === 'set-share') {
    return applyShare(app, params)
  }
  if (action === 'set-base-url') {
    app.setCustomBaseUrl(params.get('baseUrl') ?? '')
  }
  if (action === 'register') app.registerJobs()
  if (action === 'unregister') app.unregisterJobs()
  if (action === 'close') app.close()
  if (action === 'set-learner-interval' || action === 'set-publisher-interval') {
    const hours = Number(params.get('hours'))
    if (!Number.isFinite(hours) || hours < 0) {
      return { notice: 'Learner interval must be 1 hour or manual' }
    }
    if (hours !== 0 && hours < 1) {
      return refused('cadence_too_short', 'The schedule cannot be shorter than 1 hour.')
    }
    const intervalMs = hours * hourMs
    try {
      if (action === 'set-learner-interval') app.setLearnerInterval(intervalMs)
      else app.setPublisherInterval(intervalMs)
    } catch (error) {
      const notice = error instanceof Error ? error.message : 'Learner interval must be 1 hour or manual'
      if (notice === 'The schedule cannot be shorter than 1 hour.') {
        return refused('cadence_too_short', notice)
      }
      return { notice }
    }
  }
  if (action === 'start-learning') return mapStart(app.startLearning())
  if (action === 'cancel-learning') cancelLearning()
  if (action === 'recheck-sources') return ok()
  if (action === 'select-model') {
    const model = params.get('model') ?? ''
    try {
      if (model === '') app.clearModel()
      else app.selectModel(model)
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'not offered' }
    }
  }
  if (action === 'set-model-param') {
    try {
      app.setModelParam(params.get('id') ?? '', params.get('value') ?? '')
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'No model' }
    }
  }
  return ok()
}

async function commitWindow(
  holder: { app: WindowApp },
  params: URLSearchParams,
  reopen: () => WindowApp,
) {
  const action = params.get('action')
  if (action === 'pick-folder') {
    const purpose = params.get('purpose') === 'share' ? 'share' : 'knowledge'
    const chosen = await chooseFolder(purpose)
    if (!chosen) return ok()
    const problem = checkFolder(chosen)
    if (problem) return problem
    if (purpose === 'share') {
      holder.app.setDrivePath(chosen)
      return ok()
    }
    try {
      holder.app.setKnowledgePath(chosen)
      holder.app = reopen()
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'knowledge path is required' }
    }
    return ok()
  }
  if (action === 'set-knowledge') {
    const path = params.get('path') ?? ''
    const problem = checkFolder(path)
    if (problem) return problem
    try {
      holder.app.setKnowledgePath(path)
      holder.app = reopen()
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'knowledge path is required' }
    }
    return ok()
  }
  if (action === 'set-drive') {
    const path = params.get('path') ?? ''
    const problem = checkFolder(path)
    if (problem) return problem
    holder.app.setDrivePath(path.trim())
    return ok()
  }
  return applyWindow(holder.app, params)
}

async function pageState(app: WindowApp, session: Session) {
  let model = ''
  try {
    model = app.chosenModel()
  } catch {
    model = ''
  }
  const provider = app.activeProvider()
  const savedProviders = [...new Set(app.keys().map((key) => key.provider))]
  const expiresAt = app.cursorKey().expiresAt
  const graph = localGraph(app.knowledgePath(), app.drivePath(), app.autoDrop())
  const tokens = app.learningTokens()
  const unreported = app.learningTokensUnreported()
  const snapshot = learningProgress()
  return {
    title: 'Sharlie',
    paused: session.harvestPaused(),
    profile: app.profile(),
    provider,
    providers: keyProviders.map((item) => item.id),
    savedProviders,
    model,
    modelParams: app.modelParams(),
    models: provider ? app.modelChoices(provider) : [],
    hasKey: savedProviders.length > 0,
    keyExpiresAt: expiresAt,
    vaultPath: app.knowledgePath(),
    drivePath: app.drivePath(),
    autoDrop: app.share(),
    share: app.share(),
    shareAvailable: TEAM_SHARING_AVAILABLE,
    lastSharedAt: app.lastSharedAt() === '' ? null : app.lastSharedAt(),
    lastLearnedAt: app.lastLearnedAt() === '' ? null : app.lastLearnedAt(),
    cadence: app.cadence(),
    customBaseUrl: app.customBaseUrl(),
    sources: session.sourceFolders(),
    searched: session.searchedFolders(),
    chatsFound: session.sourceFolders().reduce((sum, source) => sum + source.chats, 0),
    scheduled: session.jobsRegistered(app.knowledgePath()),
    graph,
    learning: snapshot?.active ? { ...snapshot, tokens, unreported } : null,
    learningResult: learningResult(),
    learningTokens: tokens,
    learningTokensUnreported: unreported,
    ingest: app.ingestView(graph.nodes.length, app.recentTranscripts()),
  }
}

export async function openDesktopHost(options: { directory: string; session: Session }) {
  const reopen = () => options.session.openWindow(options.directory)
  const holder = { app: reopen() }
  options.session.ensureJobs(holder.app.knowledgePath())
  await loadCursorAccount(holder.app)
  return {
    async line(input: string) {
      try {
      const message = JSON.parse(input) as {
        cmd?: string
        query?: string
        action?: string
      } & Record<string, unknown>
      if (message.cmd === 'state') {
        holder.app = reopen()
        return JSON.stringify(await pageState(holder.app, options.session))
      }
      if (message.cmd === 'sync') {
        await options.session.syncNow()
        holder.app = reopen()
        return JSON.stringify(await pageState(holder.app, options.session))
      }
      if (message.cmd === 'pause') {
        if (options.session.harvestPaused()) options.session.resumeHarvest()
        else options.session.pauseHarvest()
        return JSON.stringify(await pageState(holder.app, options.session))
      }
      if (message.cmd === 'learning-view') {
        return JSON.stringify(await pageState(holder.app, options.session))
      }
      if (message.cmd === 'cancel-learning') {
        cancelLearning()
        return JSON.stringify(await pageState(holder.app, options.session))
      }
      if (message.cmd === 'lookup') {
        const result = await holder.app.lookup(message.query ?? '')
        return JSON.stringify(result)
      }
      if (message.cmd === 'action') {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(message)) {
          if (key === 'cmd' || value == null) continue
          params.set(key, String(value))
        }
        const result = await commitWindow(holder, params, reopen)
        options.session.ensureJobs(holder.app.knowledgePath())
        return JSON.stringify({ ...(await pageState(holder.app, options.session)), ...result })
      }
      return JSON.stringify({})
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const notice = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'
        try {
          return JSON.stringify({ ...(await pageState(holder.app, options.session)), notice, detail })
        } catch {
          return JSON.stringify({ notice, detail })
        }
      }
    },
  }
}

async function loadCursorAccount(app: WindowApp) {
  const secret = app.cursorSecret()
  if (secret === '') return
  try {
    const account = await app.lookupCursor(secret)
    if (!runningUnderTest()) {
      try {
        const catalog = await listCursorCatalog(secret)
        if (catalog.length > 0) {
          app.rememberCursor({ ...account, models: catalog, error: '' })
          return
        }
      } catch {
        // The REST model list remains when the SDK catalog is unavailable.
      }
    }
    app.rememberCursor(account)
  } catch (error) {
    app.rememberCursor({
      models: [],
      error: error instanceof Error ? error.message : 'Cursor model list failed',
    })
  }
}
