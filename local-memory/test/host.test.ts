import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { discardVault } from '../src/app.ts'
import { openDesktopHarness } from '../src/host.ts'
import { machineWith } from './machine.ts'

const transcript = [
  'username ada email ada@example.com team platform saw Grace Hopper.',
  'sk-ant-api03-supersecretkey ghp_abcdefghijklmnopqrstuvwxyz eyJaaaaaaaa.bbbbbbbb.cccccccc',
  'password: hunter2',
  '10.1.2.3 172.16.5.4 192.168.1.9 169.254.9.9',
  '172.15.0.1 192.167.1.1 169.253.1.1 8.8.8.8 2001:db8::1 2001:db8:fe80::1',
  'fd12:3456:789a::1 fe80::abcd fc00::',
  'MY_API_KEY=supersecretvalue',
  'DATABASE_PASSWORD="db pass"',
  'PATH=/usr/bin',
  'NOTE=hello',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXkAAAA',
  '-----END OPENSSH PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEA',
  '-----END RSA PRIVATE KEY-----',
].join('\n')

const hidden = [
  'sk-ant-api03-supersecretkey',
  'ghp_abcdefghijklmnopqrstuvwxyz',
  'eyJaaaaaaaa.bbbbbbbb.cccccccc',
  'hunter2',
  '10.1.2.3',
  '172.16.5.4',
  '192.168.1.9',
  '169.254.9.9',
  'fd12:3456:789a::1',
  'fe80::abcd',
  'fc00::',
  'supersecretvalue',
  'db pass',
  'b3BlbnNzaC1rZXkAAAA',
  'MIIEowIBAAKCAQEA',
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
]

test('the desktop host lesson writes a scrubbed card without sending secrets to the model', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-host-'))
  const machine = machineWith(join(directory, 'machine'), ['cursor'])
  let prompt = ''
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    const harness = await openDesktopHarness({
      person: 'ada',
      directory,
      machine,
      readTranscripts: () => [],
      fetchImpl: async (url, init) => {
        assert.equal(url, 'https://api.anthropic.com/v1/messages')
        const body = JSON.parse(init.body ?? '{}') as {
          max_tokens: number
          messages: { content: string }[]
        }
        assert.ok(body.max_tokens >= 4096)
        prompt = body.messages[0].content
        const lesson = {
          scope: 'work',
          title: 'Grace Hopper left sk-ant-api03-supersecretkey in the note',
          topics: ['deploys', 'Grace Hopper'],
          summary: 'Retry a failed deploy once.',
          situation: 'Grace Hopper saw 10.1.2.3 and MY_API_KEY=supersecretvalue.',
          whatToDo: 'Retry the deploy once, then read the log.',
          why: 'The lock clears on its own within a minute.',
          apply: 'Mail ada@example.com when a deploy fails on a lock.',
          otherNames: ['Grace Hopper'],
          belongsToProject: null,
          clearlyOneProduct: true,
          subjectProject: null,
          generalTechnique: false,
          solution: 'Drop the key.\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkAAAA\n-----END OPENSSH PRIVATE KEY-----',
          failure_modes: ['10.1.2.3 timed out.'],
          context: { os: 'win32', tool_version: '1', framework: 'sharlie-evolved' },
        }
        return new Response(
          JSON.stringify({
            content: [
              { type: 'thinking', thinking: '{"title":"wrong"}' },
              { type: 'text', text: JSON.stringify(lesson) },
            ],
          }),
        )
      },
    })
    timer = harness.timer
    const window = harness.session.openWindow(directory)
    window.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    window.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    const learned = await window.runLearner([
      { source: 'cursor', text: transcript, repo: 'sharlie-evolved' },
    ])
    assert.equal(learned.ran, true)
    assert.equal(learned.model, 'claude-haiku-5-5')

    for (const secret of hidden) assert.equal(prompt.includes(secret), false, secret)
    assert.equal(prompt.includes('ada@example.com'), true)
    assert.equal(prompt.includes('8.8.8.8'), true)
    assert.equal(prompt.includes('2001:db8::1'), true)
    assert.equal(prompt.includes('2001:db8:fe80::1'), true)
    assert.equal(prompt.includes('172.15.0.1'), true)
    assert.equal(prompt.includes('192.167.1.1'), true)
    assert.equal(prompt.includes('169.253.1.1'), true)
    assert.equal(prompt.includes('PATH=/usr/bin'), true)
    assert.equal(prompt.includes('NOTE=hello'), true)
    assert.equal(prompt.includes('Do not edit any files'), true)

    const folder = join(directory, 'cards')
    const cardName = readdirSync(folder).find((name) => name.endsWith('.md'))
    assert.ok(cardName)
    const card = readFileSync(join(folder, cardName), 'utf8')
    const published = readdirSync(folder)
      .filter((name) => name.endsWith('.md') || (name.endsWith('.json') && name !== '.claims.json'))
      .map((name) => readFileSync(join(folder, name), 'utf8'))
      .join('\n')
    const stored = `${card}\n${published}`
    assert.equal(stored.includes('Grace'), false)
    assert.equal(stored.includes('Hopper'), false)
    assert.equal(stored.includes('wrong'), false)
    for (const secret of hidden) assert.equal(stored.includes(secret), false, secret)
    assert.match(card, /username: ada/)
    assert.match(card, /email: ada@example.com/)
    assert.match(card, /team: platform/)
    assert.match(card, /Mail ada@example.com when a deploy fails on a lock\./)
    assert.match(card, /\[redacted\]/)
  } finally {
    if (timer) clearInterval(timer)
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Cursor uses Agent.prompt with the saved key, model id, and vault cwd', async () => {
  let seen:
    | { text: string; apiKey?: string; model?: { id: string }; local?: { cwd: string } }
    | undefined
  mock.module('@cursor/sdk', {
    exports: {
      Agent: {
        async prompt(
          text: string,
          options: { apiKey?: string; model?: { id: string }; local?: { cwd: string } },
        ) {
          seen = { text, apiKey: options.apiKey, model: options.model, local: options.local }
          return { status: 'finished', result: '{"answer":"Retry the deploy once."}' }
        },
      },
    },
  })
  const { callModel } = await import('../src/lookup-cli.ts')
  const text = await callModel({
    provider: 'cursor',
    secret: 'cursor-key',
    model: 'composer-2.5',
    prompt: 'Write the card.',
    cwd: 'C:\\vault',
  })
  assert.ok(seen)
  assert.equal(seen.apiKey, 'cursor-key')
  assert.equal(seen.model?.id, 'composer-2.5')
  assert.equal(seen.local?.cwd, 'C:\\vault')
  assert.match(seen.text, /Do not edit any files/)
  assert.equal(text, '{"answer":"Retry the deploy once."}')
})
