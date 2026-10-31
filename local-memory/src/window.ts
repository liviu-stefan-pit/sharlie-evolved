import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openUserSession, type Provider } from './app.ts'

const forceGraphPath = fileURLToPath(
  new URL('../node_modules/force-graph/dist/force-graph.min.js', import.meta.url),
)

const hourMs = 60 * 60 * 1000

type Session = ReturnType<typeof openUserSession>
type WindowApp = ReturnType<Session['openWindow']>

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hours(ms: number) {
  return String(ms / hourMs)
}

function describe(contents: ReturnType<WindowApp['show']>) {
  if (contents.kind === 'card') {
    return [
      contents.title,
      contents.synced ? 'synced' : 'not synced',
      contents.summary,
      'Situation',
      contents.situation,
      'What to do',
      contents.whatToDo,
      'Why',
      contents.why,
      'How someone who was not in the chat applies it',
      contents.apply,
    ].join('\n')
  }
  if (contents.kind === 'person') {
    return [contents.username, contents.email, contents.team, ...contents.cards].join('\n')
  }
  return [contents.name, ...contents.cards].join('\n')
}

function graphData(app: WindowApp) {
  const graph = app.graph()
  const details: Record<string, string> = {}
  for (const node of graph.nodes) details[node.id] = describe(app.show(node.id))
  return JSON.stringify({ ...graph, details }).replace(/</g, '\\u003c')
}

function renderWindow(app: WindowApp, notice = '') {
  const profile = app.profile()
  const keys = app
    .keys()
    .map((key) => {
      const use = key.active
        ? '<span>active</span>'
        : `<form method="post" action="/"><input type="hidden" name="action" value="activate-key"><input type="hidden" name="id" value="${escapeHtml(key.id)}"><button>Use</button></form>`
      return `<div data-key="${escapeHtml(key.id)}" data-provider="${key.provider}" data-active="${key.active ? 'true' : 'false'}">${key.provider} ${use}</div>`
    })
    .join('')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sharlie</title>
<style>
  html, body { height: 100%; margin: 0; background: #2e3440; color: #eceff4; font: 16px sans-serif; }
  body { display: flex; }
  .panel { background: #3b4252; color: #eceff4; padding: 16px; flex: 0 0 320px; overflow: auto; box-sizing: border-box; }
  .panel form, .panel label { display: block; margin: 0 0 10px; }
  #graph { flex: 1; min-width: 0; }
  button, select { background: #88c0d0; color: #2e3440; border: 0; }
  input, select { color: #2e3440; background: #eceff4; }
  .panel input:not([type="hidden"]), .panel select { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; }
</style>
</head>
<body>
  <div class="panel">
    <form method="post" action="/">
      <input type="hidden" name="action" value="save-profile">
      <label>Username <input data-field="username" name="username" value="${escapeHtml(profile.username)}"></label>
      <label>Email <input data-field="email" name="email" value="${escapeHtml(profile.email)}"></label>
      <label>Team <input data-field="team" name="team" value="${escapeHtml(profile.team)}"></label>
      <button>Save profile</button>
    </form>
    ${keys}
    <form method="post" action="/">
      <input type="hidden" name="action" value="save-key">
      <select data-field="provider" name="provider">
        <option value="anthropic">anthropic</option>
        <option value="openai">openai</option>
      </select>
      <label>Key <input data-field="secret" name="secret" type="password" value=""></label>
      <button>Save key</button>
    </form>
    ${modelField(app)}
    ${toolField(app)}
    <form method="post" action="/">
      <input type="hidden" name="action" value="set-drive">
      <label>Drive folder <input data-field="drive" name="path" value="${escapeHtml(app.drivePath())}"></label>
      <button>Save Drive folder</button>
    </form>
    <form method="post" action="/">
      <input type="hidden" name="action" value="set-learner-interval">
      <label>Learner interval (hours) <input data-field="learner-hours" name="hours" value="${hours(app.learnerInterval())}"></label>
      <button>Save learner interval</button>
    </form>
    <form method="post" action="/">
      <input type="hidden" name="action" value="set-publisher-interval">
      <label>Publisher interval (hours) <input data-field="publisher-hours" name="hours" value="${hours(app.publisherInterval())}"></label>
      <button>Save publisher interval</button>
    </form>
    <form method="post" action="/">
      <input type="hidden" name="action" value="register">
      <button>Register jobs</button>
    </form>
    <form method="post" action="/">
      <input type="hidden" name="action" value="unregister">
      <button>Unregister jobs</button>
    </form>
    <form method="post" action="/">
      <input type="hidden" name="action" value="close">
      <button>Close</button>
    </form>
    ${notice ? `<p data-notice>${escapeHtml(notice)}</p>` : ''}
  </div>
  <div id="graph" data-graph></div>
  <script type="application/json" id="graph-data">${graphData(app)}</script>
  <script src="/force-graph.min.js"></script>
  <script>
    const payload = JSON.parse(document.getElementById('graph-data').textContent)
    const host = document.getElementById('graph')
    host.style.display = 'flex'
    host.style.height = '100%'
    host.style.background = payload.canvas
    host.style.color = payload.text
    const surface = document.createElement('div')
    surface.style.flex = '1'
    surface.style.minWidth = '0'
    const panel = document.createElement('aside')
    panel.style.flex = '0 0 280px'
    panel.style.overflow = 'auto'
    panel.style.whiteSpace = 'pre-wrap'
    panel.style.padding = '16px'
    panel.style.boxSizing = 'border-box'
    panel.style.background = payload.panel
    panel.style.color = payload.text
    host.append(surface, panel)
    const placed = (node) => node
    new ForceGraph(surface)
      .width(Math.max(host.clientWidth - 280, 1))
      .height(Math.max(host.clientHeight, 1))
      .backgroundColor(payload.canvas)
      .nodeColor((node) => placed(node).color)
      .nodeLabel((node) => placed(node).label)
      .linkColor(() => payload.accent)
      .nodeCanvasObject((node, ctx, globalScale) => {
        const drawn = placed(node)
        const x = drawn.x || 0
        const y = drawn.y || 0
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, 2 * Math.PI)
        ctx.fillStyle = drawn.color
        ctx.fill()
        const fontSize = 12 / globalScale
        ctx.font = fontSize + 'px sans-serif'
        ctx.fillStyle = payload.text
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(drawn.label, x + 6, y)
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        const drawn = placed(node)
        ctx.beginPath()
        ctx.arc(drawn.x || 0, drawn.y || 0, 8, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
      })
      .onNodeClick((node) => {
        panel.textContent = payload.details[placed(node).id]
      })
      .graphData({ nodes: payload.nodes, links: payload.links })
  </script>
</body>
</html>`
}

function modelField(app: WindowApp) {
  const models = app.models()
  if (models.length === 0) return ''
  const chosen = app.chosenModel()
  const options = models
    .map(
      (model) =>
        `<option value="${escapeHtml(model)}"${model === chosen ? ' selected' : ''}>${escapeHtml(model)}</option>`,
    )
    .join('')
  return `<form method="post" action="/">
      <input type="hidden" name="action" value="select-model">
      <select data-field="model" name="model">${options}</select>
      <button>Save model</button>
    </form>`
}

function toolField(app: WindowApp) {
  return app
    .tools()
    .map((tool) => {
      const label = escapeHtml(tool.label)
      return `<div data-tool="${label}" data-enabled="${tool.enabled ? 'true' : 'false'}"><span>${label}</span>
      <form method="post" action="/">
        <input type="hidden" name="action" value="set-tool">
        <input type="hidden" name="label" value="${label}">
        <input type="hidden" name="enabled" value="${tool.enabled ? 'false' : 'true'}">
        <button>${tool.enabled ? 'On' : 'Off'}</button>
      </form></div>`
    })
    .join('')
}

function applyWindow(app: WindowApp, params: URLSearchParams): string {
  const action = params.get('action')
  if (action === 'save-profile') {
    app.saveProfile({
      username: params.get('username') ?? '',
      email: params.get('email') ?? '',
      team: params.get('team') ?? '',
    })
  }
  if (action === 'save-key') {
    const secret = params.get('secret') ?? ''
    const provider = params.get('provider')
    if (secret.trim() !== '' && (provider === 'anthropic' || provider === 'openai')) {
      app.saveKey({ provider: provider as Provider, secret })
    }
  }
  if (action === 'activate-key') {
    const id = params.get('id') ?? ''
    if (id !== '') app.activateKey(id)
  }
  if (action === 'register') app.registerJobs()
  if (action === 'unregister') app.unregisterJobs()
  if (action === 'close') app.close()
  if (action === 'set-learner-interval' || action === 'set-publisher-interval') {
    const intervalMs = Number(params.get('hours')) * hourMs
    try {
      if (action === 'set-learner-interval') app.setLearnerInterval(intervalMs)
      else app.setPublisherInterval(intervalMs)
    } catch (error) {
      return error instanceof Error ? error.message : 'interval must be at least one hour'
    }
  }
  if (action === 'set-drive') {
    app.setDrivePath(params.get('path') ?? '')
  }
  if (action === 'set-tool') {
    const label = params.get('label') ?? ''
    if (label !== '') app.setToolEnabled(label, params.get('enabled') === 'true')
  }
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

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(app: WindowApp, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/force-graph.min.js') {
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.end(readFileSync(forceGraphPath))
    return
  }
  if (req.method === 'POST' && url.pathname === '/') {
    const notice = applyWindow(app, new URLSearchParams(await readBody(req)))
    res.writeHead(303, { location: notice ? `/?notice=${encodeURIComponent(notice)}` : '/' })
    res.end()
    return
  }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(renderWindow(app, url.searchParams.get('notice') ?? ''))
}

export function desktopCommand(platform: 'win32' | 'darwin', url: string) {
  if (platform === 'win32') {
    const edge = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find((path) => existsSync(path))
    return { command: edge ?? 'msedge', args: [`--app=${url}`] }
  }
  return { command: 'open', args: [url] }
}

export async function launchApp(options: {
  platform: 'win32' | 'darwin'
  directory: string
  session: Session
  open: (url: string) => void
}) {
  const app = options.session.openWindow(options.directory)
  const server = createServer((req, res) => {
    void handle(app, req, res).catch((error: unknown) => {
      res.writeHead(500)
      res.end(error instanceof Error ? error.message : 'Error')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const url = `http://127.0.0.1:${address.port}/`
  options.open(url)
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
