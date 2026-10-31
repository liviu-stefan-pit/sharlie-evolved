import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openUserSession, type LessonDraft, type Transcript } from '../src/app.ts'
import { desktopCommand, launchApp } from '../src/window.ts'
import { machineWith } from './machine.ts'

function draft(
  title: string,
  scope: LessonDraft['scope'] = 'work',
  overrides: Partial<LessonDraft> = {},
): LessonDraft {
  return {
    scope,
    title,
    topics: ['deploys'],
    summary: 'Retry a failed deploy once.',
    situation: 'A deploy failed after the lock timed out.',
    whatToDo: 'Retry the deploy once, then read the log.',
    why: 'The lock clears on its own within a minute.',
    apply: 'When a deploy fails on a lock, retry once before changing config.',
    otherNames: [],
    belongsToProject: null,
    clearlyOneProduct: true,
    subjectProject: null,
    generalTechnique: false,
    ...overrides,
  }
}

async function withLaunch(
  platform: 'win32' | 'darwin',
  run: (opened: { url: string; directory: string; drive: string }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const drive = join(directory, 'drive')
  const transcripts: Transcript[] = [
    {
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    },
  ]
  const session = openUserSession(
    'ada',
    (request) => draft(request.transcript.text),
    machineWith(directory, ['cursor'], platform),
    () => transcripts,
  )
  const opened: string[] = []
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const setup = session.openWindow(directory)
    setup.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    setup.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    setup.setDrivePath(drive)
    setup.close()
    session.logIn()
    launched = await launchApp({
      platform,
      directory,
      session,
      open: (url) => opened.push(url),
    })
    assert.equal(opened[0], launched.url)
    await run({ url: launched.url, directory, drive })
  } finally {
    await launched?.close()
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
}

function machineRoot(directory: string) {
  return join(tmpdir(), `sharlie-machine-${directory.split(/[/\\]/).pop()}`)
}

async function withFresh(
  run: (opened: {
    url: string
    directory: string
    session: ReturnType<typeof openUserSession>
    transcripts: Transcript[]
    relaunch: () => Promise<string>
  }) => Promise<void>,
  installed: Parameters<typeof machineWith>[1] = ['cursor'],
  complete: (request: { transcript: Transcript }) => LessonDraft = (request) => draft(request.transcript.text),
) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const transcripts: Transcript[] = []
  const session = openUserSession(
    'ada',
    complete,
    machineWith(machineRoot(directory), installed),
    () => transcripts,
  )
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const open = async () => {
      await launched?.close()
      launched = await launchApp({
        platform: 'win32',
        directory,
        session,
        open: () => undefined,
      })
      return launched.url
    }
    await run({ url: await open(), directory, session, transcripts, relaunch: open })
  } finally {
    await launched?.close()
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
}

async function post(url: string, fields: Record<string, string>) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'follow',
  })
  return response.text()
}

function fieldValue(html: string, name: string) {
  const match = html.match(new RegExp(`data-field="${name}"[^>]*value="([^"]*)"`))
  return match?.[1] ?? ''
}

test('username, email, and team can be saved and are still there the next time the window opens', async () => {
  await withFresh(async ({ url, relaunch }) => {
    await post(url, {
      action: 'save-profile',
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
    })
    const html = await (await fetch(await relaunch())).text()
    assert.equal(fieldValue(html, 'username'), 'ada')
    assert.equal(fieldValue(html, 'email'), 'ada@example.com')
    assert.equal(fieldValue(html, 'team'), 'platform')
  })
})

function savedKeys(html: string) {
  return [...html.matchAll(/data-provider="([^"]*)" data-active="([^"]*)"/g)].map((match) => ({
    provider: match[1],
    active: match[2] === 'true',
  }))
}

test('more than one SDK key can be saved, and exactly one is active', async () => {
  await withFresh(async ({ url }) => {
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const html = await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    const keys = savedKeys(html)
    assert.equal(keys.length, 2)
    assert.equal(keys.filter((key) => key.active).length, 1)
    assert.equal(html.includes('sk-ant-api03-aaaa'), false)
    assert.equal(html.includes('sk-proj-bbbb'), false)
  })
})

function keyId(html: string, provider: string) {
  const match = html.match(new RegExp(`data-key="([^"]*)" data-provider="${provider}"`))
  return match?.[1] ?? ''
}

test('switching the active key does not require retyping the keys already saved', async () => {
  await withFresh(async ({ url, relaunch }) => {
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const saved = await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    const switched = await post(url, { action: 'activate-key', id: keyId(saved, 'openai') })
    const keys = savedKeys(switched)
    assert.equal(keys.filter((key) => key.active).map((key) => key.provider).join(), 'openai')
    assert.equal(fieldValue(switched, 'secret'), '')
    assert.equal(switched.includes('sk-proj-bbbb'), false)
    const reopened = await (await fetch(await relaunch())).text()
    assert.equal(savedKeys(reopened).filter((key) => key.active).map((key) => key.provider).join(), 'openai')
  })
})

test('keys are stored in the operating system vault and are not written into an ordinary settings file', async () => {
  await withFresh(async ({ url, directory, session }) => {
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })

    const settings = readFileSync(join(directory, 'settings.json'), 'utf8')
    assert.equal(settings.includes('sk-ant-api03-aaaa'), false)
    assert.equal(settings.includes('sk-proj-bbbb'), false)
    assert.deepEqual(readdirSync(directory), ['settings.json'])

    const window = session.openWindow(directory)
    assert.equal(window.activeKey().secret, 'sk-ant-api03-aaaa')
    const openai = window.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    window.activateKey(openai.id)
    assert.equal(window.activeKey().secret, 'sk-proj-bbbb')
  })
})

function modelOptions(html: string) {
  const start = html.indexOf('data-field="model"')
  const block = start === -1 ? '' : html.slice(start).split('</select>')[0]
  return [...block.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map((match) => ({
    value: match[1],
    selected: match[2].includes('selected'),
  }))
}

test('an Anthropic key offers claude-haiku-5-5 as the default, plus claude-sonnet-5-5 and claude-opus-5-5', async () => {
  await withFresh(async ({ url }) => {
    const html = await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const models = modelOptions(html)
    assert.deepEqual(
      models.map((model) => model.value),
      ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    )
    assert.equal(models.find((model) => model.selected)?.value, 'claude-haiku-5-5')
  })
})

test('an OpenAI key offers gpt-6-luna as the default, plus gpt-6-sol and gpt-6-astra', async () => {
  await withFresh(async ({ url }) => {
    const html = await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    const models = modelOptions(html)
    assert.deepEqual(
      models.map((model) => model.value),
      ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
    )
    assert.equal(models.find((model) => model.selected)?.value, 'gpt-6-luna')
  })
})

test('no other model is offered', async () => {
  await withFresh(async ({ url }) => {
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const html = await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    assert.deepEqual(
      modelOptions(html).map((model) => model.value),
      ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    )
    const refused = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'select-model', model: 'gpt-6-luna' }),
      redirect: 'follow',
    })
    const page = await refused.text()
    assert.match(page, /not offered/)
    assert.equal(modelOptions(page).find((model) => model.selected)?.value, 'claude-haiku-5-5')

    const openai = keyId(html, 'openai')
    const switched = await post(url, { action: 'activate-key', id: openai })
    assert.deepEqual(
      modelOptions(switched).map((model) => model.value),
      ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
    )
    assert.equal(modelOptions(switched).find((model) => model.selected)?.value, 'gpt-6-luna')
    const blocked = await post(url, { action: 'select-model', model: 'claude-opus-5-5' })
    assert.match(blocked, /not offered/)
    assert.equal(modelOptions(blocked).find((model) => model.selected)?.value, 'gpt-6-luna')
  })
})

test('the model chosen in the window is the one that writes cards and answers lookups', async () => {
  await withFresh(async ({ url, directory, session }) => {
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const html = await post(url, { action: 'select-model', model: 'claude-sonnet-5-5' })
    assert.equal(modelOptions(html).find((model) => model.selected)?.value, 'claude-sonnet-5-5')

    const window = session.openWindow(directory)
    assert.equal(window.chosenModel(), 'claude-sonnet-5-5')
    assert.equal(window.runLearner().model, 'claude-sonnet-5-5')
    assert.equal(window.answerLookup().model, 'claude-sonnet-5-5')
  })
})

test('saving the key and the model updates the Cursor and Claude discovery skills and leaves the IDE model alone', async () => {
  await withFresh(async ({ url, directory }) => {
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const saved = await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    await post(url, { action: 'select-model', model: 'claude-sonnet-5-5' })

    const home = join(machineRoot(directory), 'home')
    const cursorPath = join(home, '.cursor', 'skills', 'local-knowledge', 'SKILL.md')
    const claudePath = join(home, '.claude', 'skills', 'local-knowledge', 'SKILL.md')
    const named = readFileSync(cursorPath, 'utf8')
    assert.equal(readFileSync(claudePath, 'utf8'), named)
    assert.equal(named.includes(directory), true)
    assert.equal(named.includes('claude-sonnet-5-5'), true)
    assert.equal(named.includes('This chat uses the model selected in the IDE.'), true)

    await post(url, { action: 'activate-key', id: keyId(saved, 'openai') })
    const switched = readFileSync(cursorPath, 'utf8')
    assert.equal(readFileSync(claudePath, 'utf8'), switched)
    assert.equal(switched.includes('gpt-6-luna'), true)
    assert.equal(switched.includes('claude-sonnet-5-5'), false)
    assert.equal(switched.includes('This chat uses the model selected in the IDE.'), true)
  })
})

function toolRows(html: string) {
  return [...html.matchAll(/data-tool="([^"]*)" data-enabled="([^"]*)"/g)].map((match) => ({
    label: match[1],
    enabled: match[2] === 'true',
  }))
}

test('the window shows a label only for the installed tools, and each starts enabled', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    assert.deepEqual(
      toolRows(html).map((tool) => tool.label),
      ['Cursor', 'Claude CLI'],
    )
    assert.equal(toolRows(html).every((tool) => tool.enabled), true)
    assert.equal(html.includes('Copilot'), false)
    assert.equal(html.includes('Claude CLI'), true)
  }, ['cursor', 'claude-cli'])
})

test('turning an installed tool off skips its transcripts, and turning it back on includes them again', async () => {
  await withFresh(async ({ url, directory, session }) => {
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const off = await post(url, { action: 'set-tool', label: 'Cursor', enabled: 'false' })
    assert.equal(toolRows(off).find((tool) => tool.label === 'Cursor')?.enabled, false)

    const transcript = { source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' }
    session.openWindow(directory).runLearner([transcript])
    assert.equal(existsSync(join(directory, 'work')), false)

    const on = await post(url, { action: 'set-tool', label: 'Cursor', enabled: 'true' })
    assert.equal(toolRows(on).find((tool) => tool.label === 'Cursor')?.enabled, true)
    session.openWindow(directory).runLearner([transcript])
    assert.equal(existsSync(join(directory, 'work', 'platform')), true)
  })
})

test('the person can set the Drive folder path in the window', async () => {
  await withFresh(async ({ url, directory, relaunch }) => {
    const drive = join(directory, 'drive')
    const html = await post(url, { action: 'set-drive', path: drive })
    assert.equal(fieldValue(html, 'drive'), drive)
    const again = await (await fetch(await relaunch())).text()
    assert.equal(fieldValue(again, 'drive'), drive)
  })
})

test('an empty Drive path means the publisher does not run', async () => {
  await withFresh(async ({ url, directory, session }) => {
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const drive = join(directory, 'drive')
    await post(url, { action: 'set-drive', path: drive })
    const ready = session.openWindow(directory)
    ready.runLearner([{ source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' }])
    ready.runPublisher()
    assert.equal(existsSync(join(drive, 'platform')), true)

    const cleared = await post(url, { action: 'set-drive', path: '' })
    assert.equal(fieldValue(cleared, 'drive'), '')
    writeFileSync(join(directory, 'work', 'platform', 'extra-note.md'), 'a later work card')
    session.openWindow(directory).runPublisher()
    assert.equal(existsSync(join(drive, 'platform', 'extra-note.md')), false)
  })
})

test('the learner interval and the publisher interval each default to one hour', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    assert.equal(fieldValue(html, 'learner-hours'), '1')
    assert.equal(fieldValue(html, 'publisher-hours'), '1')
  })
})

test('the window refuses a learner or publisher interval shorter than one hour', async () => {
  await withFresh(async ({ url }) => {
    const saved = await post(url, { action: 'set-learner-interval', hours: '2' })
    assert.equal(fieldValue(saved, 'learner-hours'), '2')
    const refused = await post(url, { action: 'set-learner-interval', hours: '0' })
    assert.match(refused, /hour/)
    assert.equal(fieldValue(refused, 'learner-hours'), '2')
    assert.equal(fieldValue(refused, 'publisher-hours'), '1')

    const publisher = await post(url, { action: 'set-publisher-interval', hours: '0.5' })
    assert.match(publisher, /hour/)
    assert.equal(fieldValue(publisher, 'publisher-hours'), '1')
    assert.equal(fieldValue(publisher, 'learner-hours'), '2')

    const again = await post(url, { action: 'set-learner-interval', hours: '1' })
    assert.equal(fieldValue(again, 'learner-hours'), '1')

    const nonsense = await post(url, { action: 'set-learner-interval', hours: 'soon' })
    assert.match(nonsense, /must be at least one hour/)
    assert.equal(fieldValue(nonsense, 'learner-hours'), '1')
  })
})

const hour = 60 * 60 * 1000

test('until username, email, and team are all saved, the learner does not run', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    session.logIn()
    await post(url, { action: 'register' })
    assert.equal(existsSync(join(directory, 'work')), false)

    await post(url, {
      action: 'save-profile',
      username: 'ada',
      email: 'ada@example.com',
      team: '',
    })
    session.pass(hour)
    assert.equal(existsSync(join(directory, 'work')), false)

    await post(url, {
      action: 'save-profile',
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
    })
    session.pass(hour)
    assert.equal(existsSync(join(directory, 'work', 'platform')), true)
  })
})

test('the person can register both jobs from the window and unregister both to pause', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    const drive = join(directory, 'drive')
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'set-drive', path: drive })
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    session.logIn()
    await post(url, { action: 'register' })

    const folder = join(directory, 'work', 'platform')
    const files = readdirSync(folder)
    assert.equal(files.length, 1)
    assert.deepEqual(readFileSync(join(drive, 'platform', files[0])), readFileSync(join(folder, files[0])))

    await post(url, { action: 'unregister' })
    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    writeFileSync(join(folder, 'extra-note.md'), 'a work card added while paused')
    session.pass(hour)
    assert.equal(existsSync(join(drive, 'platform', 'extra-note.md')), false)
    assert.equal(
      readdirSync(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )

    await post(url, { action: 'register' })
    assert.equal(
      readdirSync(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      readdirSync(join(drive, 'platform')).some((file) =>
        readFileSync(join(drive, 'platform', file), 'utf8').includes('title: read the lock log'),
      ),
      true,
    )
  })
})

test('closing the window does not stop a registered job', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    const drive = join(directory, 'drive')
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'set-drive', path: drive })
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      changedAt: '2024-06-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    session.logIn()
    await post(url, { action: 'register' })
    await post(url, { action: 'close' })
    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      changedAt: '2024-07-01T00:00:00.000Z',
      repo: 'sharlie-evolved',
    })
    session.pass(hour)
    const folder = join(directory, 'work', 'platform')
    assert.equal(
      readdirSync(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('title: read the lock log')),
      true,
    )
    assert.equal(
      readdirSync(join(drive, 'platform')).some((file) =>
        readFileSync(join(drive, 'platform', file), 'utf8').includes('title: read the lock log'),
      ),
      true,
    )
  })
})

function graphPayload(html: string) {
  const match = html.match(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/)
  assert.ok(match)
  return JSON.parse(match[1]) as {
    canvas: string
    panel: string
    text: string
    accent: string
    nodes: { id: string; kind: string; label: string; color: string; synced?: boolean }[]
    links: { source: string; target: string }[]
    details: Record<string, string>
  }
}

test('the window draws every local card with force-graph', async () => {
  const lessons: Record<string, Partial<LessonDraft>> = {
    'shared deploy lesson': { scope: 'work', title: 'Retry failed deploys' },
    'private scratch': {
      scope: 'personal',
      title: 'My scratch note',
      topics: ['scratch'],
      clearlyOneProduct: false,
      generalTechnique: true,
    },
  }
  await withFresh(
    async ({ url, directory, session }) => {
      const drive = join(directory, 'drive')
      await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
      await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
      await post(url, { action: 'set-drive', path: drive })
      const ready = session.openWindow(directory)
      ready.runLearner([
        { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
        { source: 'cursor', text: 'private scratch' },
      ])
      const unpublished = graphPayload(await (await fetch(url)).text()).nodes.find(
        (node) => node.label === 'Retry failed deploys',
      )
      assert.ok(unpublished)
      assert.equal(unpublished.synced, false)
      assert.equal(unpublished.color, '#88c0d0')
      ready.runPublisher()

      const html = await (await fetch(url)).text()
      const graph = graphPayload(html)
      const style = html.split('<style>')[1]?.split('</style>')[0] ?? ''
      assert.equal(style.includes('#a3be8c'), false)
      assert.equal(graph.canvas, '#2e3440')
      assert.equal(graph.panel, '#3b4252')
      assert.equal(graph.text, '#eceff4')
      assert.equal(graph.accent, '#88c0d0')
      assert.match(html, /force-graph/)
      assert.match(html, /new ForceGraph/)

      const labels = (kind: string) =>
        graph.nodes
          .filter((node) => node.kind === kind)
          .map((node) => node.label)
          .sort()
      assert.deepEqual(labels('card'), ['My scratch note', 'Retry failed deploys'])
      assert.deepEqual(labels('person'), ['ada'])
      assert.deepEqual(labels('team'), ['platform'])
      assert.deepEqual(labels('project'), ['none', 'sharlie-evolved'])
      assert.deepEqual(labels('source'), ['cursor'])
      assert.deepEqual(labels('topic'), ['deploys', 'scratch'])
      const id = (kind: string, label: string) => {
        const node = graph.nodes.find((item) => item.kind === kind && item.label === label)
        assert.ok(node)
        return node.id
      }
      const ends = (label: string) => {
        const card = id('card', label)
        return graph.links
          .filter((link) => link.source === card || link.target === card)
          .map((link) => (link.source === card ? link.target : link.source))
          .sort()
      }
      assert.deepEqual(
        ends('Retry failed deploys'),
        [
          id('person', 'ada'),
          id('project', 'sharlie-evolved'),
          id('source', 'cursor'),
          id('team', 'platform'),
          id('topic', 'deploys'),
        ].sort(),
      )

      const work = graph.nodes.find((node) => node.label === 'Retry failed deploys')
      const personal = graph.nodes.find((node) => node.label === 'My scratch note')
      assert.ok(work && personal)
      assert.equal(work.synced, true)
      assert.equal(work.color, '#a3be8c')
      assert.equal(personal.synced, false)
      assert.equal(personal.color, '#88c0d0')
      for (const node of graph.nodes) {
        assert.equal(node.color, node.synced ? '#a3be8c' : '#88c0d0')
      }
      assert.equal(graph.details[work.id].includes('synced'), true)
      assert.equal(graph.details[work.id].includes('not synced'), false)
      assert.equal(graph.details[work.id].includes('Retry a failed deploy once.'), true)
      assert.equal(graph.details[work.id].includes('A deploy failed after the lock timed out.'), true)
      assert.equal(graph.details[personal.id].includes('not synced'), true)
      assert.equal(graph.details[personal.id].includes('\nsynced\n'), false)

      const library = await fetch(new URL('/force-graph.min.js', url))
      assert.equal(library.status, 200)
      assert.match(await library.text(), /force-graph/)
    },
    ['cursor'],
    (request) => draft(request.transcript.text, 'work', lessons[request.transcript.text]),
  )
})

test('the desktop window opens on Windows and on macOS', () => {
  assert.deepEqual(desktopCommand('darwin', 'http://127.0.0.1:9/'), {
    command: 'open',
    args: ['http://127.0.0.1:9/'],
  })
  const windows = desktopCommand('win32', 'http://127.0.0.1:9/')
  assert.equal(windows.args[0], '--app=http://127.0.0.1:9/')
  assert.match(windows.command, /msedge/i)
})

test('the person can launch the app on Windows and on macOS and see the window', async () => {
  for (const platform of ['win32', 'darwin'] as const) {
    await withLaunch(platform, async ({ url, directory, drive }) => {
      const html = await (await fetch(url)).text()
      assert.match(html, /#2e3440/)
      assert.match(html, /#3b4252/)
      assert.match(html, /#eceff4/)
      assert.match(html, /#88c0d0/)
      assert.equal(existsSync(join(directory, 'work')), false)
      assert.equal(existsSync(drive), false)
    })
  }
})
