import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openUserSession } from './app.ts'

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

const keyProviders: { id: 'cursor' | 'copilot' | 'anthropic' | 'openai'; label: string }[] = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
]

function keyRows(app: WindowApp) {
  const saved = app.keys()
  return keyProviders
    .map((provider) => {
      const savedRows = saved
        .filter((key) => key.provider === provider.id)
        .map(
          (key) =>
            `<div data-key="${escapeHtml(key.id)}" data-provider="${key.provider}" data-active="${key.active ? 'true' : 'false'}"></div>`,
        )
        .join('')
      const hasKey = savedRows !== ''
      const active = saved.some((key) => key.provider === provider.id && key.active)
      const hint = provider.id === 'cursor' ? '<span class="hint">Default</span>' : ''
      const pressed = app.activeProvider() === provider.id
      const toggle = `<form method="post" action="/"><input type="hidden" name="action" value="activate-provider"><input type="hidden" name="provider" value="${provider.id}"><button type="button" class="switch" data-sdk="${provider.id}" aria-label="Use ${escapeHtml(provider.label)}" aria-pressed="${pressed ? 'true' : 'false'}"><span class="thumb"></span></button></form>`
      const body = hasKey
        ? `${savedRows}${keyValidity(app, provider.id)}${revokeControl(provider.id)}`
        : `<form method="post" action="/"><input type="hidden" name="action" value="save-key"><input type="hidden" name="provider" value="${provider.id}"><label>Key <input data-field="secret" name="secret" type="password" value=""></label><button class="accent" type="submit">Save</button></form>`
      return `<div class="row" data-provider="${provider.id}"><div class="row-head"><span>${provider.label}</span>${hint}${toggle}</div>${body}${modelSelect(app, provider.id, active)}</div>`
    })
    .join('')
}

function daysLeft(expiresAt: string) {
  const day = 24 * 60 * 60 * 1000
  const days = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / day))
  return days === 1 ? '1 day' : `${days} days`
}

function keyValidity(app: WindowApp, provider: 'cursor' | 'copilot' | 'anthropic' | 'openai') {
  if (provider !== 'cursor') return '<p class="validity">No expiry</p>'
  const info = app.cursorKey()
  const error = info.error ? `<p class="validity">${escapeHtml(info.error)}</p>` : ''
  if (info.expiresAt) {
    return `${error}<p class="validity">Valid for ${daysLeft(info.expiresAt)} · ${escapeHtml(info.expiresAt.slice(0, 10))}</p>`
  }
  const created = info.createdAt ? escapeHtml(info.createdAt.slice(0, 10)) : ''
  return `${error}<p class="validity">No expiry</p>${created ? `<p class="validity">${created}</p>` : ''}`
}

function revokeControl(provider: string) {
  return `<form method="post" action="/"><input type="hidden" name="action" value="revoke-key"><input type="hidden" name="provider" value="${provider}"><button type="submit">Revoke</button></form>`
}

function modelSelect(app: WindowApp, provider: 'cursor' | 'copilot' | 'anthropic' | 'openai', active: boolean) {
  const models = app.modelChoices(provider)
  if (models.length === 0 || !app.keys().some((key) => key.provider === provider)) return ''
  const chosen = active ? app.chosenModel() : ''
  const options = models
    .map(
      (model) =>
        `<option value="${escapeHtml(model.id)}"${model.id === chosen ? ' selected' : ''}>${escapeHtml(model.displayName)}</option>`,
    )
    .join('')
  const field = active ? ' data-field="model"' : ''
  return `<form method="post" action="/"><input type="hidden" name="action" value="select-model"><select${field} name="model"${active ? '' : ' disabled'}>${options}</select></form>`
}

function renderWindow(app: WindowApp, notice = '') {
  const profile = app.profile()
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sharlie</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; background: #2e3440; color: #eceff4; font: 14px/1.45 system-ui, sans-serif; }
  body { height: 100%; display: flex; flex-direction: column; }
  .stage { position: relative; flex: 1; min-height: 0; display: flex; }
  .gear {
    position: absolute;
    z-index: 2;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    padding: 0;
    background: #3b4252;
    color: #88c0d0;
    border: 1px solid #4c566a;
    border-radius: 8px;
  }
  dialog {
    width: min(560px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    margin: auto;
    padding: 16px;
    overflow: auto;
    background: rgba(59, 66, 82, 0.55);
    color: #eceff4;
    border: 1px solid rgba(236, 239, 244, 0.22);
    border-radius: 16px;
    backdrop-filter: blur(18px);
    box-shadow: 0 18px 48px rgba(16, 18, 27, 0.35);
  }
  dialog::backdrop { background: rgba(46, 52, 64, 0.35); }
  [data-settings-close] { display: block; width: 100%; margin-top: 8px; }
  .tabs { display: flex; gap: 4px; margin: 0 0 16px; }
  .tabs button { flex: 1; }
  .tabs button.selected { background: #88c0d0; color: #2e3440; border: 0; }
  [data-settings] [data-pane][hidden] { display: none; }
  button {
    background: transparent;
    color: #d8dee9;
    border: 1px solid #4c566a;
    border-radius: 8px;
    padding: 8px 12px;
  }
  button.accent { background: #88c0d0; color: #2e3440; border: 0; }
  input:not([type="hidden"]), select {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 8px 10px;
    border: 1px solid #4c566a;
    border-radius: 8px;
    background: #3b4252eb;
    color: #eceff4;
  }
  form, label { display: block; margin: 0 0 12px; color: #d8dee9; }
  .row { border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; background: rgba(46, 52, 64, 0.45); border: 1px solid rgba(236, 239, 244, 0.08); }
  .row:hover { background: #434c5e; }
  .row-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #eceff4; }
  .hint { color: #d8dee9; }
  .row form { display: flex; gap: 8px; align-items: flex-end; margin: 0; }
  .row-head form { display: flex; margin: 0; }
  button.switch {
    width: 44px;
    height: 26px;
    padding: 2px;
    border: 0;
    border-radius: 999px;
    background: #4c566a;
    position: relative;
    flex: none;
  }
  button.switch[aria-pressed="true"] { background: #88c0d0; }
  button.switch .thumb {
    display: block;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #eceff4;
    transform: translateX(0);
    transition: transform 160ms ease;
  }
  button.switch[aria-pressed="true"] .thumb { transform: translateX(18px); }
  .row form label { flex: 1; margin: 0; }
  #graph { position: relative; flex: 1; min-height: 0; }
  .graph-surface { position: absolute; inset: 0; }
  .flyout {
    position: absolute;
    z-index: 2;
    right: 12px;
    bottom: 12px;
    width: min(300px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    overflow: auto;
    padding: 12px 14px;
    border-radius: 8px;
    white-space: pre-wrap;
    background: #3b4252;
    border: 1px solid #4c566a;
  }
  .flyout[hidden] { display: none !important; }
  .flyout button { margin-bottom: 8px; }
  .notice {
    position: absolute;
    z-index: 3;
    left: 16px;
    right: 16px;
    bottom: 16px;
    margin: 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: #3b4252;
    border: 1px solid #4c566a;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: #3b4252;
    border-top: 1px solid #4c566a;
  }
  .status form { display: inline-flex; margin: 0; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    margin: 0;
    padding: 0 8px 0 6px;
    border: 1px solid #4c566a;
    border-radius: 999px;
    background: #2e3440;
    color: #eceff4;
    font-size: 12px;
    line-height: 1;
  }
  .chip .light {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #bf616a;
    flex: none;
  }
  .chip[data-enabled="true"] .light { background: #a3be8c; }
  .status .path { margin-left: auto; color: #d8dee9; font-size: 12px; line-height: 1.2; }
  .start-wrap {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin: 0;
  }
  button.start {
    padding: 14px 22px;
    border-radius: 999px;
    border: 1px solid rgba(136, 192, 208, 0.45);
    background: rgba(59, 66, 82, 0.45);
    backdrop-filter: blur(16px);
    color: #eceff4;
    font-size: 16px;
  }
  button.start:disabled { opacity: 0.45; }
  .start-hint { margin: 0; color: #d8dee9; }
</style>
</head>
<body>
  <div class="stage">
    <button type="button" class="gear" data-gear aria-label="Settings">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.4 1.05.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.58-.22 1.12-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>
    </button>
    ${notice ? `<p class="notice" data-notice>${escapeHtml(notice)}</p>` : ''}
    ${startControl(app)}
    <div id="graph" data-graph></div>
    <aside class="flyout" data-flyout hidden>
      <button type="button" data-flyout-close>Close</button>
      <div data-flyout-body></div>
    </aside>
  </div>
  <footer class="status" data-status>
    ${toolField(app)}
    <span class="path" data-knowledge>${escapeHtml(app.knowledgePath())}</span>
  </footer>
  <dialog data-settings>
    <div class="tabs">
      <button type="button" data-tab="you" class="selected">You</button>
      <button type="button" data-tab="keys">Keys</button>
      <button type="button" data-tab="paths">Paths</button>
      <button type="button" data-tab="schedule">Schedule</button>
    </div>
    <section data-pane="you">
        <form method="post" action="/">
          <input type="hidden" name="action" value="save-profile">
          <label>Username <input data-field="username" name="username" value="${escapeHtml(profile.username)}"></label>
          <label>Email <input data-field="email" name="email" value="${escapeHtml(profile.email)}"></label>
          <label>Team <input data-field="team" name="team" value="${escapeHtml(profile.team)}"></label>
          <button class="accent" type="submit">Save profile</button>
        </form>
      </section>
    <section data-pane="keys" hidden>
        ${keyRows(app)}
      </section>
    <section data-pane="paths" hidden>
        <form method="post" action="/">
          <input type="hidden" name="action" value="set-drive">
          <label>Drive folder <input data-field="drive" name="path" value="${escapeHtml(app.drivePath())}"></label>
          <button class="accent" type="submit">Save Drive folder</button>
        </form>
        <form method="post" action="/">
          <input type="hidden" name="action" value="set-knowledge">
          <label>Local knowledge <input data-field="knowledge" name="path" value="${escapeHtml(app.knowledgePath())}"></label>
          <button class="accent" type="submit">Save knowledge folder</button>
        </form>
      </section>
    <section data-pane="schedule" hidden>
        <form method="post" action="/">
          <input type="hidden" name="action" value="set-learner-interval">
          <label>Learner interval (hours) <input data-field="learner-hours" name="hours" value="${hours(app.learnerInterval())}"></label>
          <button class="accent" type="submit">Save learner interval</button>
        </form>
        <form method="post" action="/">
          <input type="hidden" name="action" value="set-publisher-interval">
          <label>Publisher interval (hours) <input data-field="publisher-hours" name="hours" value="${hours(app.publisherInterval())}"></label>
          <button class="accent" type="submit">Save publisher interval</button>
        </form>
        <form method="post" action="/">
          <input type="hidden" name="action" value="register">
          <button type="submit">Register jobs</button>
        </form>
        <form method="post" action="/">
          <input type="hidden" name="action" value="unregister">
          <button type="submit">Unregister jobs</button>
        </form>
    </section>
    <button type="button" data-settings-close>Close</button>
  </dialog>
  <script type="application/json" id="graph-data">${graphData(app)}</script>
  <script src="/force-graph.min.js"></script>
  <script>
    if (window.__TAURI__) {
      document.addEventListener('submit', async (event) => {
        event.preventDefault()
        event.stopPropagation()
        const form = event.target
        const body = new URLSearchParams(new FormData(form)).toString()
        const html = await window.__TAURI__.core.invoke('submit', { body })
        document.open()
        document.write(html)
        document.close()
      }, true)
    }
    const payload = JSON.parse(document.getElementById('graph-data').textContent)
    const host = document.getElementById('graph')
    const flyout = document.querySelector('[data-flyout]')
    const flyoutBody = document.querySelector('[data-flyout-body]')
    host.style.background = payload.canvas
    host.style.color = payload.text
    const surface = document.createElement('div')
    surface.className = 'graph-surface'
    host.append(surface)
    const drawn = new ForceGraph(surface)
      .backgroundColor(payload.canvas)
      .nodeColor((node) => node.color)
      .nodeLabel((node) => node.label)
      .linkColor(() => payload.accent)
      .nodeCanvasObject((node, ctx, globalScale) => {
        const x = node.x || 0
        const y = node.y || 0
        ctx.beginPath()
        ctx.arc(x, y, 4, 0, 2 * Math.PI)
        ctx.fillStyle = node.color
        ctx.fill()
        const fontSize = 12 / globalScale
        ctx.font = fontSize + 'px sans-serif'
        ctx.fillStyle = payload.text
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.label, x + 6, y)
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.beginPath()
        ctx.arc(node.x || 0, node.y || 0, 8, 0, 2 * Math.PI)
        ctx.fillStyle = color
        ctx.fill()
      })
      .onNodeClick((node) => {
        flyoutBody.textContent = payload.details[node.id] || ''
        flyout.hidden = false
      })
    function fit() {
      drawn.width(Math.max(surface.clientWidth, 1)).height(Math.max(surface.clientHeight, 1))
    }
    drawn.onEngineStop(() => {
      fit()
      drawn.zoomToFit(400, 48)
    })
    drawn.graphData({ nodes: payload.nodes, links: payload.links })
    fit()
    addEventListener('resize', () => {
      fit()
      drawn.zoomToFit(0, 48)
    })
    const settings = document.querySelector('[data-settings]')
    function showSettings(name) {
      document.querySelectorAll('[data-tab]').forEach((button) => {
        button.classList.toggle('selected', button.dataset.tab === name)
      })
      for (const pane of ['you', 'keys', 'paths', 'schedule']) {
        const section = settings.querySelector('[data-pane="' + pane + '"]')
        if (section) section.hidden = pane !== name
      }
    }
    function openPane() {
      const selected = settings.querySelector('[data-tab].selected')
      return selected ? selected.dataset.tab : 'you'
    }
    settings.addEventListener('cancel', (event) => event.preventDefault())
    async function applyForm(form, name) {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
      })
      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const next = doc.querySelector('[data-settings]')
      if (next) settings.innerHTML = next.innerHTML
      showSettings(name)
      const status = document.querySelector('[data-status]')
      const nextStatus = doc.querySelector('[data-status]')
      if (status && nextStatus) status.innerHTML = nextStatus.innerHTML
      const stage = document.querySelector('.stage')
      const nextStage = doc.querySelector('.stage')
      const notice = stage.querySelector('[data-notice]')
      if (notice) notice.remove()
      const nextNotice = nextStage && nextStage.querySelector('[data-notice]')
      if (nextNotice) stage.insertBefore(nextNotice, stage.querySelector('[data-graph]'))
      const start = stage.querySelector('.start-wrap')
      if (start) start.remove()
      const nextStart = nextStage && nextStage.querySelector('.start-wrap')
      if (nextStart) stage.insertBefore(nextStart, stage.querySelector('[data-graph]'))
    }
    settings.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : event.target.parentElement
      if (!target) return
      if (event.target === settings) settings.close()
      if (target.closest('[data-settings-close]')) {
        settings.close()
        return
      }
      const tab = target.closest('[data-tab]')
      if (tab) showSettings(tab.dataset.tab)
      const toggle = target.closest('[data-sdk]')
      if (!toggle || !toggle.form) return
      settings.querySelectorAll('[data-sdk]').forEach((button) => {
        button.setAttribute('aria-pressed', button === toggle ? 'true' : 'false')
      })
      const pane = toggle.form.closest('[data-pane]')
      applyForm(toggle.form, pane ? pane.dataset.pane : openPane())
    })
    settings.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.target
      const pane = form.closest('[data-pane]')
      applyForm(form, pane ? pane.dataset.pane : openPane())
    })
    settings.addEventListener('change', (event) => {
      const target = event.target
      if (target.matches('[data-sdk], [data-field="model"]') && target.form) target.form.requestSubmit()
    })
    document.querySelector('[data-gear]').addEventListener('click', () => settings.showModal())
    document.querySelector('[data-flyout-close]').addEventListener('click', () => {
      flyout.hidden = true
    })
  </script>
</body>
</html>`
}

function startControl(app: WindowApp) {
  if (app.graph().nodes.length > 0) return ''
  const ready = app.keys().some((key) => key.active)
  const hint = ready ? '' : '<p class="start-hint" data-start-hint>Add a key in Settings.</p>'
  return `<form class="start-wrap" method="post" action="/">
      <input type="hidden" name="action" value="start-learning">
      <button type="submit" class="start" data-start-learning${ready ? '' : ' disabled'}>Start learning</button>
      ${hint}
    </form>`
}

function toolField(app: WindowApp) {
  return app
    .tools()
    .map((tool) => {
      const label = escapeHtml(tool.label)
      return `<span class="chip" data-tool="${label}" data-enabled="true"><span class="light" data-light="on"></span>${label}</span>`
    })
    .join('')
}

async function saveKey(app: WindowApp, params: URLSearchParams) {
  const secret = params.get('secret') ?? ''
  const provider = params.get('provider')
  if (
    secret.trim() === '' ||
    (provider !== 'cursor' && provider !== 'copilot' && provider !== 'anthropic' && provider !== 'openai')
  ) {
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
    if (provider === 'cursor' || provider === 'copilot' || provider === 'anthropic' || provider === 'openai') {
      app.revokeProvider(provider)
    }
  }
  if (action === 'activate-key') {
    const id = params.get('id') ?? ''
    if (id !== '') app.activateKey(id)
  }
  if (action === 'activate-provider') {
    const provider = params.get('provider')
    if (provider === 'cursor' || provider === 'copilot' || provider === 'anthropic' || provider === 'openai') {
      app.activateProvider(provider)
    }
  }
  if (action === 'register') app.registerJobs()
  if (action === 'unregister') app.unregisterJobs()
  if (action === 'close') app.close()
  if (action === 'set-learner-interval' || action === 'set-publisher-interval') {
    const hours = Number(params.get('hours'))
    const intervalMs = hours * hourMs
    try {
      if (!Number.isFinite(hours)) throw new Error('interval must be at least one hour')
      if (action === 'set-learner-interval') app.setLearnerInterval(intervalMs)
      else app.setPublisherInterval(intervalMs)
    } catch (error) {
      return error instanceof Error ? error.message : 'interval must be at least one hour'
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

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(
  holder: { app: WindowApp },
  req: IncomingMessage,
  res: ServerResponse,
  reopen: () => WindowApp,
) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/force-graph.min.js') {
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.end(readFileSync(forceGraphPath))
    return
  }
  if (req.method === 'POST' && url.pathname === '/') {
    const notice = await commitWindow(holder, new URLSearchParams(await readBody(req)), reopen)
    res.writeHead(303, { location: notice ? `/?notice=${encodeURIComponent(notice)}` : '/' })
    res.end()
    return
  }
  await loadCursorAccount(holder.app)
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(renderWindow(holder.app, url.searchParams.get('notice') ?? ''))
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

export async function openDesktopHost(options: { directory: string; session: Session }) {
  const reopen = () => options.session.openWindow(options.directory)
  const holder = { app: reopen() }
  await loadCursorAccount(holder.app)
  return {
    async line(input: string) {
      const message = JSON.parse(input) as { cmd?: string; body?: string }
      const notice =
        message.cmd === 'submit' ? await commitWindow(holder, new URLSearchParams(message.body ?? ''), reopen) : ''
      return JSON.stringify({ html: renderWindow(holder.app, notice) })
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

export async function launchApp(options: {
  platform: 'win32' | 'darwin'
  directory: string
  session: Session
  open: (url: string) => void
}) {
  const holder = { app: options.session.openWindow(options.directory) }
  const server = createServer((req, res) => {
    void handle(holder, req, res, () => options.session.openWindow(options.directory)).catch((error: unknown) => {
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
