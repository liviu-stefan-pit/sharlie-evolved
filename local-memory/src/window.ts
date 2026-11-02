import { cancelLearning, learningProgress, learningResult, openUserSession, type Provider } from './app.ts'
import { listCopilotModels, listCursorCatalog } from './exchange.ts'
import { mockModelEnabled } from './host.ts'
import { runningUnderTest } from './login-item.ts'
import { localGraph } from './synapse.ts'

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
    if (cadence === '15m' || cadence === '30m' || cadence === '1h' || cadence === 'manual') app.setCadence(cadence)
  }
  if (action === 'set-auto-drop') {
    app.setAutoDrop(params.get('enabled') === 'true')
  }
  if (action === 'set-base-url') {
    app.setCustomBaseUrl(params.get('baseUrl') ?? '')
  }
  if (action === 'register') app.registerJobs()
  if (action === 'unregister') app.unregisterJobs()
  if (action === 'close') app.close()
  if (action === 'set-learner-interval' || action === 'set-publisher-interval') {
    const hours = Number(params.get('hours'))
    const intervalMs = hours * hourMs
    try {
      if (!Number.isFinite(hours) || hours < 0) throw new Error('Learner interval must be 15 minutes, 30 minutes, 1 hour, or manual')
      if (action === 'set-learner-interval') app.setLearnerInterval(intervalMs)
      else app.setPublisherInterval(intervalMs)
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'Learner interval must be 15 minutes, 30 minutes, 1 hour, or manual' }
    }
  }
  if (action === 'set-drive') {
    app.setDrivePath(params.get('path') ?? '')
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
  if (params.get('action') === 'set-knowledge') {
    try {
      holder.app.setKnowledgePath(params.get('path') ?? '')
      holder.app = reopen()
    } catch (error) {
      return { notice: error instanceof Error ? error.message : 'knowledge path is required' }
    }
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
    autoDrop: app.autoDrop(),
    cadence: app.cadence(),
    customBaseUrl: app.customBaseUrl(),
    sources: session.sourceFolders(),
    searched: session.searchedFolders(),
    chatsFound: session.sourceFolders().reduce((sum, source) => sum + source.chats, 0),
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
