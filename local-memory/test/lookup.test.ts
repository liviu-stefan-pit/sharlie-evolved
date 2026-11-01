import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { discardVault, lookupCursorAccount, openApp, type AnswerLookup, type LessonDraft, type Transcript } from '../src/app.ts'
import { machineWith } from './machine.ts'

function withDirectory(run: (directory: string) => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  const finish = () => {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    const result = run(directory)
    if (result instanceof Promise) return result.finally(finish)
  } catch (error) {
    finish()
    throw error
  }
  finish()
}

function draft(overrides: Partial<LessonDraft> = {}): LessonDraft {
  return {
    scope: 'work',
    title: 'Retry failed deploys',
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

function ready(directory: string, complete: (request: { transcript: Transcript }) => LessonDraft, answer: AnswerLookup) {
  const app = openApp(directory, complete, machineWith(directory, ['cursor', 'claude']), answer)
  app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  return app
}

test('a lookup sends every card file name and summary first, personal and work together', () => {
  return withDirectory(async (directory) => {
    const calls: Parameters<AnswerLookup>[0][] = []
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': {
        scope: 'work',
        title: 'Retry failed deploys',
        summary: 'Retry a failed deploy once.',
        situation: 'A deploy failed after the lock timed out.',
      },
      'private scratch': {
        scope: 'personal',
        title: 'My scratch note',
        summary: 'Keep the scratch note on this machine.',
        situation: 'The scratch note is only for me.',
      },
    }
    const app = ready(
      directory,
      (request) => draft(lessons[request.transcript.text]),
      (turn) => {
        calls.push(turn)
        return { pick: [] }
      },
    )
    app.selectModel('claude-sonnet-5-5')
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])

    const names = readdirSync(join(directory, 'cards'))
      .filter((name) => name.endsWith('.md'))
      .sort((left, right) => `cards/${left}`.localeCompare(`cards/${right}`))
    await app.lookup('how do I retry a deploy?')

    assert.equal(calls[0].model, 'claude-sonnet-5-5')
    assert.equal(calls[0].question, 'how do I retry a deploy?')
    assert.ok('catalog' in calls[0])
    if (!('catalog' in calls[0])) return
    assert.deepEqual(
      calls[0].catalog,
      names.map((name) => ({
        file: `cards/${name}`,
        summary: readFileSync(join(directory, 'cards', name), 'utf8').match(/^title: "?(.+?)"?$/m)?.[1],
      })),
    )
    const first = JSON.stringify(calls[0])
    assert.equal(first.includes('The scratch note is only for me.'), false)
    assert.equal(first.includes('A deploy failed after the lock timed out.'), false)
  })
})

test('a lookup then sends the full text of only the cards the model picks', () => {
  return withDirectory(async (directory) => {
    const calls: Parameters<AnswerLookup>[0][] = []
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': {
        scope: 'work',
        title: 'Retry failed deploys',
        summary: 'Retry a failed deploy once.',
        situation: 'A deploy failed after the lock timed out.',
      },
      'private scratch': {
        scope: 'personal',
        title: 'My scratch note',
        summary: 'Keep the scratch note on this machine.',
        situation: 'The scratch note is only for me.',
      },
    }
    const app = ready(
      directory,
      (request) => draft(lessons[request.transcript.text]),
      (turn) => {
        calls.push(turn)
        if ('catalog' in turn) {
          const picked = turn.catalog.filter((card) => {
            const name = card.file.split('/').pop() ?? ''
            return readFileSync(join(directory, 'cards', name), 'utf8').includes('title: Retry failed deploys')
          })
          return { pick: picked.map((card) => card.file) }
        }
        return { answer: 'Retry the deploy once.' }
      },
    )
    app.selectModel('claude-sonnet-5-5')
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])

    const work = readdirSync(join(directory, 'cards')).find(
      (name) => name.endsWith('.md') && readFileSync(join(directory, 'cards', name), 'utf8').includes('title: Retry failed deploys'),
    )
    assert.ok(work)
    const result = await app.lookup('how do I retry a deploy?')

    assert.equal(calls.length, 2)
    assert.equal(calls[1].model, 'claude-sonnet-5-5')
    assert.equal(calls[1].question, 'how do I retry a deploy?')
    assert.ok('cards' in calls[1])
    if (!('cards' in calls[1])) return
    assert.deepEqual(calls[1].cards, [
      {
        file: `cards/${work}`,
        text: readFileSync(join(directory, 'cards', work), 'utf8'),
      },
    ])
    assert.equal(JSON.stringify(calls[1]).includes('The scratch note is only for me.'), false)
    assert.deepEqual(result, { model: 'claude-sonnet-5-5', answer: 'Retry the deploy once.' })
  })
})

function filesUnder(root: string) {
  if (!existsSync(root)) return []
  const found: string[] = []
  function walk(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

test('the lookup command sends the catalog, then only the picked card, and returns that answer', () => {
  return withDirectory(async (directory) => {
    const { main } = await import('../src/lookup-cli.ts')
    const machine = machineWith(directory, ['cursor', 'claude'])
    const lessons: Record<string, Partial<LessonDraft>> = {
      'shared deploy lesson': {
        scope: 'work',
        title: 'Retry failed deploys',
        summary: 'Retry a failed deploy once.',
        situation: 'A deploy failed after the lock timed out.',
      },
      'private scratch': {
        scope: 'personal',
        title: 'My scratch note',
        summary: 'Keep the scratch note on this machine.',
        situation: 'The scratch note is only for me.',
      },
    }
    const app = openApp(
      directory,
      (request) => draft(lessons[request.transcript.text]),
      machine,
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.selectModel('claude-sonnet-5-5')
    app.runLearner([
      { source: 'cursor', text: 'shared deploy lesson', repo: 'sharlie-evolved' },
      { source: 'cursor', text: 'private scratch' },
    ])
    const work = readdirSync(join(directory, 'cards')).find(
      (name) => name.endsWith('.md') && readFileSync(join(directory, 'cards', name), 'utf8').includes('title: Retry failed deploys'),
    )
    assert.ok(work)
    const calls: { model: string; secret: string; prompt: string }[] = []
    const answer = await main(
      [directory, 'how do I retry a deploy?'],
      async (request: { model: string; secret: string; prompt: string }) => {
        calls.push({ model: request.model, secret: request.secret, prompt: request.prompt })
        if (calls.length === 1) return JSON.stringify({ pick: [`cards/${work}`] })
        return JSON.stringify({ answer: 'Retry the deploy once.' })
      },
      machine,
    )

    assert.equal(calls.length, 2)
    assert.equal(calls[0].model, 'claude-sonnet-5-5')
    assert.equal(calls[0].secret, 'sk-ant-api03-aaaa')
    assert.equal(calls[0].prompt.includes('cards/'), true)
    assert.equal(calls[0].prompt.includes('Retry failed deploys'), true)
    assert.equal(calls[0].prompt.includes('My scratch note'), true)
    assert.equal(calls[0].prompt.includes('The scratch note is only for me.'), false)
    assert.equal(calls[0].prompt.includes('A deploy failed after the lock timed out.'), false)
    assert.equal(calls[1].model, 'claude-sonnet-5-5')
    assert.equal(calls[1].secret, 'sk-ant-api03-aaaa')
    assert.equal(calls[1].prompt.includes('A deploy failed after the lock timed out.'), true)
    assert.equal(calls[1].prompt.includes('The scratch note is only for me.'), false)
    assert.equal(answer, 'Retry the deploy once.')
  })
})

test('an Anthropic lookup sends the prompt to the chosen model with the saved key', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let seen: { url: string; key: string; version: string; model: string; prompt: string } | undefined
  const replied = await callModel(
    {
      provider: 'anthropic',
      secret: 'sk-ant-api03-aaaa',
      model: 'claude-sonnet-5-5',
      prompt: 'Catalog:\nwork/platform/retry.md\nRetry a failed deploy once.',
    },
    async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { model: string; max_tokens: number; messages: { content: string }[] }
      seen = {
        url,
        key: init.headers?.['x-api-key'] ?? '',
        version: init.headers?.['anthropic-version'] ?? '',
        model: body.model,
        prompt: body.messages[0].content,
      }
      assert.ok(body.max_tokens >= 4096)
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"answer":"Retry the deploy once."}' }] }))
    },
  )
  assert.ok(seen)
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(seen.key, 'sk-ant-api03-aaaa')
  assert.equal(seen.version, '2023-06-01')
  assert.equal(seen.model, 'claude-sonnet-5-5')
  assert.equal(seen.prompt, 'Catalog:\nwork/platform/retry.md\nRetry a failed deploy once.')
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('an OpenAI lookup sends the prompt to the chosen model with the saved key', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let seen: { url: string; authorization: string; model: string; prompt: string } | undefined
  const replied = await callModel(
    {
      provider: 'openai',
      secret: 'sk-proj-bbbb',
      model: 'gpt-6-luna',
      prompt: 'Catalog:\nwork/platform/retry.md\nRetry a failed deploy once.',
    },
    async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { model: string; max_tokens: number; messages: { content: string }[] }
      seen = {
        url,
        authorization: init.headers?.authorization ?? '',
        model: body.model,
        prompt: body.messages[0].content,
      }
      assert.ok(body.max_tokens >= 4096)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"answer":"Retry the deploy once."}' } }] }),
      )
    },
  )
  assert.ok(seen)
  assert.equal(seen.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(seen.authorization, 'Bearer sk-proj-bbbb')
  assert.equal(seen.model, 'gpt-6-luna')
  assert.equal(seen.prompt, 'Catalog:\nwork/platform/retry.md\nRetry a failed deploy once.')
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('an Anthropic reply joins every text block and skips a preceding thinking block', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  const replied = await callModel(
    {
      provider: 'anthropic',
      secret: 'sk-ant-api03-aaaa',
      model: 'claude-sonnet-5-5',
      prompt: 'Write the card.',
    },
    async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: '{"title":"wrong"}' },
            { type: 'text', text: '{"answer":' },
            { type: 'text', text: '"Retry the deploy once."}' },
          ],
        }),
      ),
  )
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('a Cursor lookup uses the injected agent prompt with the saved key and model', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let sent = false
  let seen: { secret: string; model: string; prompt: string; cwd?: string } | undefined
  const replied = await callModel(
    {
      provider: 'cursor',
      secret: 'cursor-key',
      model: 'composer-2.5',
      prompt: 'Reply with JSON {"answer":"..."}.',
      cwd: 'C:\\vault',
    },
    async () => {
      sent = true
      return new Response('no')
    },
    {
      cursorPrompt: async (request) => {
        seen = { secret: request.secret, model: request.model, prompt: request.prompt, cwd: request.cwd }
        return '{"answer":"Retry the deploy once."}'
      },
    },
  )
  assert.equal(sent, false)
  assert.ok(seen)
  assert.equal(seen.secret, 'cursor-key')
  assert.equal(seen.model, 'composer-2.5')
  assert.equal(seen.cwd, 'C:\\vault')
  assert.match(seen.prompt, /Do not edit any files/)
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('a Copilot lookup sends the saved token to the GitHub API', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let seen: { url: string; authorization: string; integration: string; model: string; prompt: string } | undefined
  const replied = await callModel(
    {
      provider: 'copilot',
      secret: 'copilot-token',
      model: 'gpt-4o',
      prompt: 'Catalog:\nwork/platform/retry.md',
    },
    async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { model: string; messages: { content: string }[] }
      seen = {
        url,
        authorization: init.headers?.authorization ?? '',
        integration: init.headers?.['Copilot-Integration-Id'] ?? '',
        model: body.model,
        prompt: body.messages[0].content,
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"Retry the deploy once."}' } }] }))
    },
  )
  assert.ok(seen)
  assert.equal(seen.url, 'https://api.githubcopilot.com/chat/completions')
  assert.equal(seen.authorization, 'Bearer copilot-token')
  assert.equal(seen.integration, 'copilot-developer-cli')
  assert.equal(seen.model, 'gpt-4o')
  assert.equal(seen.prompt, 'Catalog:\nwork/platform/retry.md')
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('a Copilot model without chat completions uses the responses API', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let seen = ''
  const replied = await callModel(
    {
      provider: 'copilot',
      secret: 'copilot-token',
      model: 'resp-model',
      prompt: 'Catalog',
      chatCompletions: false,
    },
    async (url: string) => {
      seen = url
      return new Response(JSON.stringify({ output_text: '{"answer":"Retry the deploy once."}' }))
    },
  )
  assert.equal(seen, 'https://api.githubcopilot.com/responses')
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('a custom lookup posts to the saved OpenAI-compatible base URL', async () => {
  const { callModel } = await import('../src/lookup-cli.ts')
  let seen: { url: string; authorization: string; model: string } | undefined
  const replied = await callModel(
    {
      provider: 'custom',
      secret: 'local-key',
      model: 'llama-local',
      prompt: 'Catalog',
      baseUrl: 'http://127.0.0.1:8080/v1/',
    },
    async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      const body = JSON.parse(init.body ?? '{}') as { model: string; max_tokens: number }
      seen = { url, authorization: init.headers?.authorization ?? '', model: body.model }
      assert.ok(body.max_tokens >= 4096)
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"Retry the deploy once."}' } }] }))
    },
  )
  assert.ok(seen)
  assert.equal(seen.url, 'http://127.0.0.1:8080/v1/chat/completions')
  assert.equal(seen.authorization, 'Bearer local-key')
  assert.equal(seen.model, 'llama-local')
  assert.equal(replied.text, '{"answer":"Retry the deploy once."}')
  assert.equal(replied.tokens, null)
})

test('Copilot model list marks chat completions unavailable when the entry says so', async () => {
  const { listCopilotModels } = await import('../src/exchange.ts')
  let seen: { url: string; authorization: string; integration: string } | undefined
  const models = await listCopilotModels('copilot-token', async (url, init) => {
    seen = {
      url,
      authorization: init.headers?.authorization ?? '',
      integration: init.headers?.['Copilot-Integration-Id'] ?? '',
    }
    return new Response(
      JSON.stringify({
        data: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'resp-model', displayName: 'Responses', capabilities: { supports: { chat_completions: false } } },
        ],
      }),
    )
  })
  assert.ok(seen)
  assert.equal(seen.url, 'https://api.githubcopilot.com/models')
  assert.equal(seen.authorization, 'Bearer copilot-token')
  assert.equal(seen.integration, 'copilot-developer-cli')
  assert.deepEqual(models, [
    { id: 'gpt-4o', displayName: 'GPT-4o' },
    { id: 'resp-model', displayName: 'Responses', chatCompletions: false },
  ])
})

test('Cursor and Claude discovery skills point at the local knowledge and name the model, and the IDE model picker stays as it is', () => {
  withDirectory((directory) => {
    const machine = machineWith(directory, ['cursor', 'claude', 'copilot'])
    const app = openApp(directory, undefined, machine)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    app.selectModel('claude-sonnet-5-5')

    const cursorPath = join(machine.home, '.cursor', 'skills', 'local-knowledge', 'SKILL.md')
    const claudePath = join(machine.home, '.claude', 'skills', 'local-knowledge', 'SKILL.md')
    const lookupCli = fileURLToPath(new URL('../src/lookup-cli.ts', import.meta.url))
    const named = readFileSync(cursorPath, 'utf8')
    assert.equal(readFileSync(claudePath, 'utf8'), named)
    assert.equal(named.includes(directory), true)
    assert.equal(named.includes('claude-sonnet-5-5'), true)
    assert.equal(named.includes(`node "${lookupCli}" "${directory}"`), true)
    assert.equal(named.includes('Use that command\'s output as the answer.'), true)
    assert.equal(named.includes('This chat uses the model selected in the IDE.'), true)
    assert.deepEqual(filesUnder(join(machine.home, '.cursor')), [cursorPath])
    assert.deepEqual(filesUnder(join(machine.home, '.claude')), [claudePath])
    assert.equal(
      filesUnder(machine.home).some((file) => file.endsWith('SKILL.md') && file !== cursorPath && file !== claudePath),
      false,
    )

    const openai = app.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    app.activateKey(openai.id)
    const switched = readFileSync(cursorPath, 'utf8')
    assert.equal(readFileSync(claudePath, 'utf8'), switched)
    assert.equal(switched.includes(directory), true)
    assert.equal(switched.includes('gpt-6-luna'), true)
    assert.equal(switched.includes('claude-sonnet-5-5'), false)
    assert.equal(switched.includes('This chat uses the model selected in the IDE.'), true)

    const reopened = readFileSync(cursorPath, 'utf8')
    openApp(directory, undefined, machine)
    assert.equal(readFileSync(cursorPath, 'utf8'), reopened)
    assert.equal(readFileSync(claudePath, 'utf8'), reopened)
  })
})

test('cursor account lookup reads key expiry from the me endpoint', async () => {
  const seen: string[] = []
  const account = await lookupCursorAccount('cursor-key', async (url) => {
    seen.push(String(url))
    if (String(url) === 'https://api.cursor.com/v1/models') {
      return new Response(JSON.stringify({ items: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }] }), { status: 200 })
    }
    if (String(url) === 'https://api.cursor.com/v1/me') {
      return new Response(
        JSON.stringify({ createdAt: '2026-10-01T00:00:00.000Z', apiKeyExpiresAtMs: Date.parse('2026-11-12T00:00:00.000Z') }),
        { status: 200 },
      )
    }
    return new Response('missing', { status: 404 })
  })
  assert.equal('createdAt' in account, false)
  assert.equal(account.expiresAt, '2026-11-12T00:00:00.000Z')
  assert.equal(seen.includes('https://api.cursor.com/v1/me'), true)
})

test('cursor account lookup reads expiry from the key list when the me call has none', async () => {
  const account = await lookupCursorAccount('cursor-key-e5f6', async (url) => {
    const address = String(url)
    if (address === 'https://api.cursor.com/v1/models') {
      return new Response(JSON.stringify({ items: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }] }), { status: 200 })
    }
    if (address === 'https://api.cursor.com/v1/me') {
      return new Response(JSON.stringify({ createdAt: '2026-10-01T00:00:00.000Z' }), { status: 200 })
    }
    if (address === 'https://api2.cursor.sh/auth/exchange_user_api_key') {
      return new Response(JSON.stringify({ accessToken: 'session-token' }), { status: 200 })
    }
    if (address === 'https://api2.cursor.sh/aiserver.v1.DashboardService/ListUserApiKeys') {
      return new Response(
        JSON.stringify({
          apiKeys: [
            { maskedKey: 'crsr_...ffff', createdAt: '1780000000000' },
            { maskedKey: 'crsr_...e5f6', createdAt: '1780000000000', expiresAt: '2026-11-12T00:00:00.000Z' },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response('missing', { status: 404 })
  })
  assert.equal(account.expiresAt, '2026-11-12T00:00:00.000Z')
})

test('cursor account lookup keeps expiry empty when neither call returns one', async () => {
  const account = await lookupCursorAccount('cursor-key-e5f6', async (url) => {
    const address = String(url)
    if (address === 'https://api.cursor.com/v1/models') {
      return new Response(JSON.stringify({ items: [{ id: 'composer-2.5', displayName: 'Composer 2.5' }] }), { status: 200 })
    }
    if (address === 'https://api.cursor.com/v1/me') {
      return new Response(JSON.stringify({ createdAt: '2026-10-01T00:00:00.000Z' }), { status: 200 })
    }
    if (address === 'https://api2.cursor.sh/auth/exchange_user_api_key') {
      return new Response(JSON.stringify({ accessToken: 'session-token' }), { status: 200 })
    }
    if (address === 'https://api2.cursor.sh/aiserver.v1.DashboardService/ListUserApiKeys') {
      return new Response(JSON.stringify({ apiKeys: [{ maskedKey: 'crsr_...e5f6', createdAt: '1780000000000' }] }), {
        status: 200,
      })
    }
    return new Response('missing', { status: 404 })
  })
  assert.equal(account.expiresAt, '')
  assert.equal('createdAt' in account, false)
})
