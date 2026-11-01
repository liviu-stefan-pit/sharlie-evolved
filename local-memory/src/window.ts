import { openUserSession, type Provider } from './app.ts'
import { listCopilotModels } from './exchange.ts'
import { runningUnderTest } from './login-item.ts'
import { localGraph } from './synapse.ts'

const hourMs = 60 * 60 * 1000

type Session = ReturnType<typeof openUserSession>
type WindowApp = ReturnType<Session['openWindow']>

const keyProviders: { id: Provider; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'custom', label: 'Custom' },
]

async function saveKey(app: WindowApp, params: URLSearchParams) {
  const secret = params.get('secret') ?? ''
  const provider = params.get('provider')
  if (
    secret.trim() === '' ||
    (provider !== 'cursor' && provider !== 'copilot' && provider !== 'anthropic' && provider !== 'openai' && provider !== 'custom')
  ) {
    return ''
  }
  if (provider === 'custom') {
    app.saveKey({
      provider,
      secret,
      baseUrl: params.get('baseUrl') ?? '',
      model: params.get('model') ?? '',
    })
    return ''
  }
  if (provider === 'cursor') {
    let account
    try {
      account = await app.lookupCursor(secret)
    } catch (error) {
      account = { models: [], error: error instanceof Error ? error.message : 'Cursor model list failed' }
    }
    app.saveKey({ provider, secret, account })
    return ''
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
    return ''
  }
  app.saveKey({ provider, secret })
  return ''
}

function applyWindow(app: WindowApp, params: URLSearchParams): string | Promise<string> {
  const action = params.get('action')
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
      return error instanceof Error ? error.message : 'Learner interval must be 15 minutes, 30 minutes, 1 hour, or manual'
    }
  }
  if (action === 'set-drive') {
    app.setDrivePath(params.get('path') ?? '')
  }
  if (action === 'start-learning') return app.startLearning()
  if (action === 'select-model') {
    const model = params.get('model') ?? ''
    if (model === '') return ''
    try {
      app.selectModel(model)
    } catch (error) {
      return error instanceof Error ? error.message : 'not offered'
    }
  }
  return ''
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
      return error instanceof Error ? error.message : 'knowledge path is required'
    }
    return ''
  }
  return applyWindow(holder.app, params)
}

function maskKey(secret: string) {
  if (secret === '') return ''
  return `••••${secret.slice(-4)}`
}

async function pageState(app: WindowApp, session: Session) {
  let secret = ''
  try {
    secret = app.activeKey().secret
  } catch {
    secret = ''
  }
  let model = ''
  try {
    model = app.chosenModel()
  } catch {
    model = ''
  }
  const provider = app.activeProvider()
  return {
    title: 'Sharlie',
    paused: session.harvestPaused(),
    profile: app.profile(),
    provider,
    providers: keyProviders.map((item) => item.id),
    model,
    models: provider ? app.modelChoices(provider) : [],
    keyMask: maskKey(secret),
    hasKey: secret !== '',
    vaultPath: app.knowledgePath(),
    drivePath: app.drivePath(),
    autoDrop: app.autoDrop(),
    cadence: app.cadence(),
    customBaseUrl: app.customBaseUrl(),
    sources: session.sourceFolders(),
    graph: localGraph(app.knowledgePath(), app.drivePath(), app.autoDrop()),
  }
}

export async function openDesktopHost(options: { directory: string; session: Session }) {
  const reopen = () => options.session.openWindow(options.directory)
  const holder = { app: reopen() }
  await loadCursorAccount(holder.app)
  return {
    async line(input: string) {
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
      if (message.cmd === 'lookup') {
        const result = await holder.app.lookup(message.query ?? '')
        return JSON.stringify(result)
      }
      if (message.cmd === 'reveal-key') {
        try {
          return JSON.stringify({ secret: holder.app.activeKey().secret })
        } catch {
          return JSON.stringify({ secret: '' })
        }
      }
      if (message.cmd === 'action') {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(message)) {
          if (key === 'cmd' || value == null) continue
          params.set(key, String(value))
        }
        const notice = await commitWindow(holder, params, reopen)
        return JSON.stringify({ ...(await pageState(holder.app, options.session)), notice })
      }
      return JSON.stringify({})
    },
  }
}

async function loadCursorAccount(app: WindowApp) {
  const secret = app.cursorSecret()
  if (secret === '') return
  try {
    app.rememberCursor(await app.lookupCursor(secret))
  } catch (error) {
    app.rememberCursor({
      models: [],
      error: error instanceof Error ? error.message : 'Cursor model list failed',
    })
  }
}
