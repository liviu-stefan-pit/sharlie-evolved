import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openUserSession, type CursorLookup, type LessonDraft, type Transcript } from '../src/app.ts'
import { readSecret } from '../src/vault.ts'
import { launchApp, openDesktopHost } from '../src/window.ts'
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
  cursorLookup: CursorLookup = async () => ({ models: [] }),
) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const transcripts: Transcript[] = []
  const session = openUserSession(
    'ada',
    complete,
    machineWith(machineRoot(directory), installed),
    () => transcripts,
    cursorLookup,
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

function startButton(html: string) {
  return html.match(/<button[^>]*data-start-learning[^>]*>/)?.[0] ?? ''
}

test('an empty graph shows a disabled glass Start learning button until a key is saved', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    assert.match(startButton(html), /disabled/)
    assert.match(html, />Start learning</)
    assert.match(html, /Add a key in Settings/)
    assert.match(html, /backdrop-filter:\s*blur/)
  })
})

test('saving a key enables Start learning, and a card removes the button', async () => {
  await withFresh(async ({ url, directory, session }) => {
    const saved = await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
    assert.equal(startButton(saved).includes('disabled'), false)
    assert.equal(saved.includes('Add a key in Settings'), false)

    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    const both = await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'activate-key', id: keyId(both, 'anthropic') })
    session.openWindow(directory).runLearner([
      { source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' },
    ])
    const html = await (await fetch(url)).text()
    assert.equal(html.includes('data-start-learning'), false)
  })
})

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

test('a Cursor key with only a created date says it has no expiry', async () => {
  await withFresh(
    async ({ url }) => {
      const html = await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
      const pane = settingsPane(html, 'keys')
      const cursor = pane.slice(pane.indexOf('data-provider="cursor"'), pane.indexOf('data-provider="copilot"'))
      assert.match(cursor, /No expiry/)
      assert.match(cursor, /2026-10-01/)
      assert.equal(cursor.includes('Valid for'), false)
    },
    ['cursor'],
    undefined,
    async () => ({
      models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }],
      createdAt: '2026-10-01T00:00:00.000Z',
    }),
  )
})

test('Revoke removes the key and brings back the key field', async () => {
  await withFresh(
    async ({ url, directory }) => {
      const saved = await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
      const keyId = saved.match(/data-key="([^"]+)"/)?.[1] ?? ''
      const revoked = await post(url, { action: 'revoke-key', provider: 'cursor' })
      const pane = settingsPane(revoked, 'keys')
      const cursor = pane.slice(pane.indexOf('data-provider="cursor"'), pane.indexOf('data-provider="copilot"'))
      assert.match(cursor, /type="password"/)
      assert.equal(cursor.includes('data-key='), false)
      assert.equal(cursor.includes('<select'), false)
      assert.equal(cursor.includes('>Revoke<'), false)
      const settings = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')) as {
        vaultId: string
        cursorModels: unknown[]
      }
      assert.deepEqual(settings.cursorModels, [])
      assert.throws(() => readSecret(settings.vaultId, keyId))
    },
    ['cursor'],
    undefined,
    async () => ({
      models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }],
      createdAt: '2026-10-01T00:00:00.000Z',
    }),
  )
})

test('a Cursor key card shows the time left when Cursor returns an expiry', async () => {
  const day = 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + 12 * day).toISOString()
  await withFresh(
    async ({ url }) => {
      const html = await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
      const pane = settingsPane(html, 'keys')
      const cursor = pane.slice(pane.indexOf('data-provider="cursor"'), pane.indexOf('data-provider="copilot"'))
      assert.match(cursor, /Valid for 12 days/)
      assert.equal(cursor.includes('type="password"'), false)
      assert.match(cursor, />Revoke</)
    },
    ['cursor'],
    undefined,
    async () => ({
      models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }],
      createdAt: '2026-10-01T00:00:00.000Z',
      expiresAt,
    }),
  )
})

test('a failed Cursor lookup keeps the last expiry and models and shows the error', async () => {
  const day = 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + 12 * day).toISOString()
  let failed = false
  await withFresh(
    async ({ url }) => {
      await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
      failed = true
      const html = await (await fetch(url)).text()
      const pane = settingsPane(html, 'keys')
      const cursor = pane.slice(pane.indexOf('data-provider="cursor"'), pane.indexOf('data-provider="copilot"'))
      assert.match(cursor, /Cursor models 401/)
      assert.match(cursor, /Valid for 12 days/)
      assert.deepEqual(
        modelOptions(html).map((model) => model.value),
        ['composer-2.5'],
      )
    },
    ['cursor'],
    undefined,
    async () => {
      if (failed) return { models: [], error: 'Cursor models 401' }
      return {
        models: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }],
        createdAt: '2026-10-01T00:00:00.000Z',
        expiresAt,
      }
    },
  )
})

test('a stored Cursor key loads its expiry and models when the window opens', async () => {
  const day = 24 * 60 * 60 * 1000
  const expiresAt = new Date(Date.now() + 12 * day).toISOString()
  await withFresh(
    async ({ directory, session, relaunch }) => {
      session.openWindow(directory).saveKey({ provider: 'cursor', secret: 'cursor-key' })
      const html = await (await fetch(await relaunch())).text()
      const pane = settingsPane(html, 'keys')
      const cursor = pane.slice(pane.indexOf('data-provider="cursor"'), pane.indexOf('data-provider="copilot"'))
      assert.match(cursor, /Valid for 12 days/)
      assert.deepEqual(
        modelOptions(html).map((model) => model.value),
        ['composer-2.5', 'auto-smart'],
      )
      assert.equal(modelOptions(html).find((model) => model.selected)?.value, 'composer-2.5')
    },
    ['cursor'],
    undefined,
    async () => ({
      models: [
        { id: 'composer-2.5', displayName: 'Composer 2.5' },
        { id: 'auto-smart', displayName: 'Auto' },
      ],
      createdAt: '2026-10-01T00:00:00.000Z',
      expiresAt,
    }),
  )
})

test('a saved Cursor key lists the models Cursor returned and selects the first', async () => {
  await withFresh(
    async ({ url }) => {
      const html = await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
      const pane = settingsPane(html, 'keys')
      assert.match(pane, />Composer 2\.5</)
      assert.deepEqual(
        modelOptions(html).map((model) => model.value),
        ['composer-2.5', 'auto-smart'],
      )
      assert.equal(modelOptions(html).find((model) => model.selected)?.value, 'composer-2.5')
      assert.equal(html.includes('cursor-key'), false)
    },
    ['cursor'],
    undefined,
    async () => ({
      models: [
        { id: 'composer-2.5', displayName: 'Composer 2.5' },
        { id: 'auto-smart', displayName: 'Auto' },
      ],
    }),
  )
})

test('turning on a provider with no key turns the others off and stops learning', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      repo: 'sharlie-evolved',
      changedAt: '2024-06-01T00:00:00.000Z',
    })
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'start-learning' })
    session.logIn()
    await post(url, { action: 'register' })
    assert.equal(existsSync(join(directory, 'work', 'platform')), true)

    const switched = await post(url, { action: 'activate-provider', provider: 'copilot' })
    assert.equal(switched.includes('No model'), false)
    assert.equal(switched.includes('No active key'), false)
    const pane = settingsPane(switched, 'keys')
    assert.equal(pane.includes('type="checkbox"'), false)
    assert.match(pane, /<button[^>]*data-sdk="copilot"[^>]*aria-pressed="true"/)
    assert.equal(pane.match(/aria-pressed="true"/g)?.length, 1)
    assert.equal(pane.includes('data-field="model"'), false)
    assert.match(switched, /button\.switch\[aria-pressed="true"\] \.thumb \{ transform: translateX/)
    assert.match(switched, /transition: transform/)

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      repo: 'sharlie-evolved',
      changedAt: '2024-07-01T00:00:00.000Z',
    })
    session.pass(hour)
    const folder = join(directory, 'work', 'platform')
    assert.equal(
      readdirSync(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      false,
    )

    await post(url, { action: 'activate-provider', provider: 'anthropic' })
    session.pass(hour)
    assert.equal(
      readdirSync(folder).some((file) => readFileSync(join(folder, file), 'utf8').includes('read the lock log')),
      true,
    )
  })
})

test('Keys offers an SDK toggle, and model lists for Cursor, Anthropic, and OpenAI', async () => {
  await withFresh(async ({ url }) => {
    const fresh = settingsPane(await (await fetch(url)).text(), 'keys')
    assert.equal(fresh.includes('type="checkbox"'), false)
    for (const provider of ['cursor', 'copilot', 'anthropic', 'openai']) {
      assert.match(fresh, new RegExp(`<button[^>]*data-sdk="${provider}"[^>]*aria-pressed="false"`))
    }
    assert.equal(fresh.includes('data-field="model"'), false)
    assert.equal(fresh.includes('>Use<'), false)

    const cursor = settingsPane(
      await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' }),
      'keys',
    )
    assert.match(cursor, /data-sdk="cursor"[^>]*aria-pressed="true"/)
    assert.equal(cursor.match(/aria-pressed="true"/g)?.length, 1)
    assert.match(cursor, /data-field="model"/)
    assert.match(cursor, /Composer 2\.5/)

    const switched = settingsPane(
      await post(url, { action: 'activate-provider', provider: 'anthropic' }),
      'keys',
    )
    assert.match(switched, /data-sdk="anthropic"[^>]*aria-pressed="true"/)
    assert.equal(switched.match(/aria-pressed="true"/g)?.length, 1)

    const anthropic = await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const usingAnthropic = await post(url, { action: 'activate-provider', provider: 'anthropic' })
    const anthropicPane = settingsPane(usingAnthropic, 'keys')
    assert.match(anthropicPane, /data-sdk="anthropic"[^>]*aria-pressed="true"/)
    assert.equal(anthropicPane.match(/aria-pressed="true"/g)?.length, 1)
    assert.deepEqual(
      modelOptions(usingAnthropic).map((model) => model.value),
      ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    )
    assert.equal(anthropicPane.includes('gpt-6-luna'), false)
    assert.equal(anthropic.includes('>Use<'), false)

    await post(url, { action: 'save-key', provider: 'openai', secret: 'sk-proj-bbbb' })
    const usingOpenAI = await post(url, { action: 'activate-provider', provider: 'openai' })
    const openaiPane = settingsPane(usingOpenAI, 'keys')
    assert.match(openaiPane, /data-sdk="openai"[^>]*aria-pressed="true"/)
    assert.equal(openaiPane.match(/aria-pressed="true"/g)?.length, 1)
    assert.deepEqual(
      modelOptions(usingOpenAI).map((model) => model.value),
      ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
    )
    assert.equal(openaiPane.includes('data-field="model"'), true)
    const anthropicSelect = openaiPane.slice(openaiPane.indexOf('data-provider="anthropic"'), openaiPane.indexOf('data-provider="openai"'))
    assert.equal(anthropicSelect.includes('data-field="model"'), false)
  }, ['cursor'], undefined, async () => ({
    models: [
      { id: 'composer-2.5', displayName: 'Composer 2.5' },
      { id: 'auto-smart', displayName: 'Auto' },
    ],
  }))
})

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
    assert.equal(html.includes('Copilot in VS Code'), false)
    assert.equal(html.includes('Copilot CLI'), false)
    assert.equal(html.includes('Claude CLI'), true)
  }, ['cursor', 'claude-cli'])
})

test('the status labels are indicators, and an installed tool is still learned', async () => {
  await withFresh(async ({ url, directory, session }) => {
    const html = await (await fetch(url)).text()
    const bar = statusBar(html)
    assert.equal(bar.includes('<button'), false)
    assert.equal(bar.includes('<form'), false)
    assert.match(bar, /<span class="chip" data-tool="Cursor" data-enabled="true">/)

    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const settingsPath = join(directory, 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { disabledTools?: string[] }
    settings.disabledTools = ['cursor']
    writeFileSync(settingsPath, JSON.stringify(settings))
    session.openWindow(directory).runLearner([
      { source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' },
    ])
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

test('Start learning stays put until a profile and a model are saved, then one click imports and later hours see only changes', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    transcripts.push({
      id: 'deploy',
      source: 'cursor',
      text: 'retry the deploy',
      repo: 'sharlie-evolved',
      changedAt: '2024-06-01T00:00:00.000Z',
    })
    await post(url, { action: 'save-key', provider: 'cursor', secret: 'cursor-key' })
    const cursorOnly = await post(url, { action: 'start-learning' })
    assert.match(cursorOnly, /Save your username, email, and team before learning can write cards/)
    assert.match(startButton(cursorOnly), /data-start-learning/)
    assert.equal(existsSync(join(directory, 'work')), false)

    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    const noModel = await post(url, { action: 'start-learning' })
    assert.match(noModel, /This SDK has no model list/)
    assert.match(startButton(noModel), /data-start-learning/)
    assert.equal(existsSync(join(directory, 'work')), false)

    session.logIn()
    await post(url, { action: 'register' })
    session.pass(hour)
    assert.equal(existsSync(join(directory, 'work')), false)

    const both = await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'activate-key', id: keyId(both, 'anthropic') })
    const started = await post(url, { action: 'start-learning' })
    assert.equal(started.includes('data-start-learning'), false)
    assert.equal(existsSync(join(directory, 'work', 'platform')), true)

    transcripts.push({
      id: 'later',
      source: 'cursor',
      text: 'read the lock log',
      repo: 'sharlie-evolved',
      changedAt: '2024-07-01T00:00:00.000Z',
    })
    session.pass(hour)
    const folder = join(directory, 'work', 'platform')
    const cards = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(cards.some((card) => card.includes('read the lock log')), true)
  })
})

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
    assert.equal(existsSync(join(directory, 'work')), false)
    await post(url, { action: 'start-learning' })
    assert.equal(existsSync(join(directory, 'work', 'platform')), true)
  })
})

test('the person can register both jobs from the window and unregister both to pause', async () => {
  await withFresh(async ({ url, directory, session, transcripts }) => {
    const drive = join(directory, 'drive')
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'save-key', provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    await post(url, { action: 'set-drive', path: drive })
    await post(url, { action: 'start-learning' })
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
    await post(url, { action: 'start-learning' })
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
      const withoutIndicator = style.replace(/\.chip\[data-enabled="true"\] \.light \{[^}]*\}/, '')
      assert.match(style, /\.chip\[data-enabled="true"\] \.light \{[^}]*#a3be8c/)
      assert.equal(withoutIndicator.includes('#a3be8c'), false)
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

test('opening the window shows the graph fitted to the page and settings stay closed', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    assert.match(html, /id="graph"/)
    assert.doesNotMatch(html, /data-pane="graph"[^>]*\bhidden\b/)
    assert.doesNotMatch(html, /class="window"/)
    assert.match(html, /data-gear/)
    assert.match(html, /<dialog\b[^>]*data-settings\b/)
    assert.doesNotMatch(html, /<dialog\b[^>]*\bopen\b/)
    assert.match(html, /zoomToFit\(/)
  })
})

function settingsDialog(html: string) {
  const start = html.indexOf('<dialog')
  const end = html.indexOf('</dialog>')
  return html.slice(start, end < 0 ? html.length : end)
}

function settingsPane(html: string, name: string) {
  const dialog = settingsDialog(html)
  const start = dialog.indexOf(`data-pane="${name}"`)
  if (start < 0) return ''
  const next = dialog.indexOf('data-pane=', start + 1)
  return dialog.slice(start, next < 0 ? dialog.length : next)
}

test('the settings dialog is glass, Close is at the bottom, and a click outside closes it', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    const style = html.split('<style>')[1]?.split('</style>')[0] ?? ''
    const dialogRule = style.match(/dialog\s*\{[^}]*\}/)?.[0] ?? ''
    assert.match(dialogRule, /backdrop-filter:\s*blur/)
    assert.match(dialogRule, /background:\s*rgba\(/)
    const dialog = settingsDialog(html)
    assert.ok(dialog.lastIndexOf('data-settings-close') > dialog.lastIndexOf('data-pane='))
    assert.match(html, /event\.target === settings\) settings\.close\(\)/)
    assert.match(html, /closest\('\[data-sdk\]'\)/)
    assert.match(html, /setAttribute\('aria-pressed'/)
    assert.match(html, /settings\.addEventListener\('submit'/)
    assert.match(html, /settings\.addEventListener\('cancel', \(event\) => event\.preventDefault\(\)\)/)
  })
})

test('settings are You, Keys, Paths, and Schedule inside the gear dialog', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    const dialog = settingsDialog(html)
    assert.deepEqual(
      [...dialog.matchAll(/data-tab="([^"]+)"[^>]*>([^<]+)/g)].map((match) => match[2].trim()),
      ['You', 'Keys', 'Paths', 'Schedule'],
    )
    assert.match(settingsPane(html, 'you'), /data-field="username"/)
    assert.match(settingsPane(html, 'you'), /data-field="email"/)
    assert.match(settingsPane(html, 'you'), /data-field="team"/)
    assert.match(settingsPane(html, 'keys'), /data-provider="cursor"/)
    assert.match(settingsPane(html, 'keys'), /data-provider="copilot"/)
    assert.match(settingsPane(html, 'keys'), /data-provider="anthropic"/)
    assert.match(settingsPane(html, 'keys'), /data-provider="openai"/)
    assert.match(settingsPane(html, 'paths'), /data-field="drive"/)
    assert.match(settingsPane(html, 'schedule'), /data-field="learner-hours"/)
    assert.match(settingsPane(html, 'schedule'), /data-field="publisher-hours"/)
    assert.match(settingsPane(html, 'schedule'), /name="action" value="register"/)
    assert.match(settingsPane(html, 'schedule'), /name="action" value="unregister"/)
  })
})

function statusBar(html: string) {
  const start = html.indexOf('<footer')
  const end = html.indexOf('</footer>')
  return start < 0 || end < 0 ? '' : html.slice(start, end)
}

test('the status bar shows each installed tool as a short chip with a connection light', async () => {
  await withFresh(async ({ url }) => {
    const html = await (await fetch(url)).text()
    const bar = statusBar(html)
    assert.equal(bar.includes('>On<'), false)
    assert.equal(bar.includes('>Off<'), false)
    assert.equal(bar.includes('class="row"'), false)
    assert.equal(bar.includes('Copilot in VS Code'), false)
    assert.match(bar, /<span class="chip" data-tool="Cursor" data-enabled="true">/)
    assert.match(bar, /data-tool="Cursor" data-enabled="true"[\s\S]*data-light="on"/)
    assert.match(bar, /data-tool="Claude CLI" data-enabled="true"[\s\S]*data-light="on"/)
    assert.equal(bar.includes('<button'), false)
    assert.match(html, /\.status \{[^}]*padding: 3px 10px/)
    assert.match(html, /\.chip \{[^}]*height: 20px/)
    assert.match(html, /\.chip \.light \{[^}]*background: #bf616a/)
    assert.match(html, /\.chip\[data-enabled="true"\] \.light \{[^}]*background: #a3be8c/)
  }, ['cursor', 'claude-cli'])
})

test('the status bar shows each installed source and the knowledge path', async () => {
  await withFresh(async ({ url, directory }) => {
    const html = await (await fetch(url)).text()
    const bar = statusBar(html)
    assert.deepEqual(toolRows(bar), [
      { label: 'Cursor', enabled: true },
      { label: 'Claude CLI', enabled: true },
    ])
    assert.equal(bar.includes('Copilot in VS Code'), false)
    assert.equal(bar.includes('Copilot CLI'), false)
    assert.equal(bar.includes(directory), true)
    assert.equal(settingsDialog(html).includes('data-tool='), false)
    assert.ok(html.indexOf('id="graph"') < html.indexOf('<footer'))
  }, ['cursor', 'claude-cli'])
})

test('saving a knowledge path creates that folder, shows it on the next open, and leaves the old cards', async () => {
  await withFresh(async ({ url, directory, relaunch }) => {
    const card = join(directory, 'personal', 'keep.md')
    mkdirSync(join(directory, 'personal'), { recursive: true })
    writeFileSync(card, 'stay here')
    await post(url, { action: 'save-profile', username: 'ada', email: 'ada@example.com', team: 'platform' })
    await post(url, { action: 'register' })

    const next = join(directory, 'elsewhere')
    const saved = await post(url, { action: 'set-knowledge', path: next })
    assert.equal(existsSync(next), true)
    assert.equal(statusBar(saved).includes(next), true)
    assert.equal(fieldValue(saved, 'username'), 'ada')
    assert.equal(fieldValue(saved, 'team'), 'platform')
    assert.equal(readFileSync(card, 'utf8'), 'stay here')
    assert.equal(existsSync(join(next, 'personal', 'keep.md')), false)

    const registry = JSON.parse(
      readFileSync(join(machineRoot(directory), 'home', '.sharlie', 'ada.json'), 'utf8'),
    ) as {
      directories: string[]
      knowledge: string
    }
    assert.equal(registry.knowledge, next)
    assert.deepEqual(registry.directories, [next])

    const updated = await post(url, {
      action: 'save-profile',
      username: 'ada',
      email: 'ada@example.com',
      team: 'writers',
    })
    assert.equal(fieldValue(updated, 'team'), 'writers')
    assert.equal(readFileSync(join(next, 'settings.json'), 'utf8').includes('"team":"writers"'), true)
    assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8').includes('"team":"writers"'), false)

    const refused = await post(url, { action: 'set-knowledge', path: '   ' })
    assert.match(refused, /knowledge path is required/)
    assert.equal(statusBar(refused).includes(next), true)

    const again = await (await fetch(await relaunch())).text()
    assert.equal(statusBar(again).includes(next), true)
    assert.equal(readFileSync(card, 'utf8'), 'stay here')
  })
})

function listeningSockets() {
  const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
  return output
    .split(/\r?\n/)
    .filter((line) => line.includes('LISTENING') && line.trim().endsWith(String(process.pid)))
}

test('the window host renders Sharlie and applies a form without listening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const session = openUserSession(
    'ada',
    (request) => draft(request.transcript.text),
    machineWith(machineRoot(directory), ['cursor']),
    () => [],
  )
  session.logIn()
  const before = listeningSockets()
  try {
    const host = await openDesktopHost({ directory, session })
    const rendered = JSON.parse(await host.line(JSON.stringify({ cmd: 'render' }))) as { html: string }
    assert.match(rendered.html, /<title>Sharlie<\/title>/)
    const saved = JSON.parse(
      await host.line(
        JSON.stringify({
          cmd: 'submit',
          body: new URLSearchParams({
            action: 'save-profile',
            username: 'ada',
            email: 'ada@example.com',
            team: 'platform',
          }).toString(),
        }),
      ),
    ) as { html: string }
    assert.equal(fieldValue(saved.html, 'username'), 'ada')
    assert.equal(fieldValue(saved.html, 'email'), 'ada@example.com')
    assert.equal(fieldValue(saved.html, 'team'), 'platform')
    assert.deepEqual(listeningSockets(), before)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
})

test('the desktop window is a Tauri shell titled Sharlie', () => {
  const text = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  const config = JSON.parse(text) as { app: { windows: { title: string; width: number; height: number }[] } }
  assert.equal(config.app.windows[0].title, 'Sharlie')
  assert.equal(config.app.windows[0].width, 1280)
  assert.equal(config.app.windows[0].height, 800)
  assert.equal(text.includes('127.0.0.1'), false)
  assert.equal(text.includes('msedge'), false)
  assert.equal(text.includes('open'), false)
  assert.equal(text.includes('localhost'), false)
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

function listedProviders(html: string) {
  const fromMarkup = [...html.matchAll(/data-provider="(cursor|copilot|anthropic|openai)"/g)].map((match) => match[1])
  if (fromMarkup.length > 0) return fromMarkup
  const copilot = html.indexOf('Copilot')
  const anthropic = html.indexOf('Anthropic', copilot + 1)
  const openai = html.indexOf('OpenAI', anthropic + 1)
  const cursor = copilot < 0 ? -1 : html.lastIndexOf('Cursor', copilot)
  const cursorIsTool = cursor >= 0 && html.slice(Math.max(0, cursor - 16), cursor).includes('data-tool=')
  if (cursor < 0 || cursorIsTool || anthropic < copilot || openai < anthropic) return []
  return ['cursor', 'copilot', 'anthropic', 'openai']
}

function cursorRow(html: string) {
  const at = html.indexOf('data-provider="cursor"')
  if (at >= 0) {
    const next = html.indexOf('data-provider="', at + 'data-provider="'.length)
    return html.slice(at, next < 0 ? html.length : next)
  }
  const label = html.indexOf('Cursor')
  const copilot = html.indexOf('Copilot', label + 1)
  if (label >= 0 && copilot > label) return html.slice(label, copilot)
  return ''
}

function activeProviders(html: string) {
  return savedKeys(html)
    .filter((key) => key.active)
    .map((key) => key.provider)
    .join()
}

function fieldRules(style: string) {
  return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => /\binput\b|\bselect\b/.test(match[1]))
    .map((match) => match[2])
}

test('the window saves Cursor, Copilot, Anthropic, and OpenAI, and ignores any other provider', async () => {
  await withFresh(async ({ url }) => {
    await post(url, { action: 'save-key', provider: 'copilot', secret: 'sk-ant-api03-aaaa' })
    const savedCursor = await post(url, { action: 'save-key', provider: 'cursor', secret: 'sk-proj-bbbb' })
    assert.equal(activeProviders(savedCursor), 'cursor')

    const ignored = await post(url, { action: 'save-key', provider: 'gemini', secret: 'sk-other-value' })
    assert.equal(savedKeys(ignored).some((key) => key.provider === 'gemini'), false)
    const blank = await post(url, { action: 'save-key', provider: 'openai', secret: '   ' })
    assert.equal(savedKeys(blank).some((key) => key.provider === 'openai'), false)

    await post(url, { action: 'activate-key', id: keyId(savedCursor, 'copilot') })
    const pinned = await post(url, { action: 'save-key', provider: 'cursor', secret: 'sk-proj-cccc' })
    assert.equal(activeProviders(pinned), 'copilot')
  })
})

test('the Keys pane lists Cursor, then Copilot, then Anthropic, then OpenAI, and Cursor stays in use unless another key is chosen', async () => {
  await withFresh(async ({ url, directory }) => {
    const html = await (await fetch(url)).text()
    assert.deepEqual(listedProviders(html), ['cursor', 'copilot', 'anthropic', 'openai'])
    assert.match(cursorRow(html), /Default/)

    await post(url, { action: 'save-key', provider: 'copilot', secret: 'sk-ant-api03-aaaa' })
    const savedCursor = await post(url, { action: 'save-key', provider: 'cursor', secret: 'sk-proj-bbbb' })
    assert.equal(activeProviders(savedCursor), 'cursor')

    await post(url, { action: 'activate-key', id: keyId(savedCursor, 'copilot') })
    const pinned = await post(url, { action: 'save-key', provider: 'cursor', secret: 'sk-proj-bbbb' })
    assert.equal(activeProviders(pinned), 'copilot')

    const settingsPath = join(directory, 'settings.json')
    const settings = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : ''
    assert.equal(settings.includes('sk-ant-api03-aaaa'), false)
    assert.equal(settings.includes('sk-proj-bbbb'), false)

    const style = html.split('<style>')[1]?.split('</style>')[0] ?? ''
    const fields = fieldRules(style).join('\n')
    assert.equal(/\bbackground(?:-color)?\s*:\s*#eceff4\b/i.test(fields), false)
    assert.match(
      fields,
      /#3b4252[0-9a-fA-F]{2}|rgba?\(\s*59\s*,\s*66\s*,\s*82\s*,\s*(?:0?\.\d+|\d+%)|rgba?\(\s*59\s+66\s+82\s*\/\s*[\d.]+%?|color-mix\([^)]*#3b4252[^)]*transparent/i,
    )
    assert.doesNotMatch(html, /class="window"/)
  })
})
