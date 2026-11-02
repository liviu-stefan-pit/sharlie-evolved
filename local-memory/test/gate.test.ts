import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openApp } from '../src/app.ts'
import { listSecrets } from '../src/vault.ts'
import { machineWith, syncRun } from './machine.ts'

function machineRoot(directory: string) {
  return join(tmpdir(), `sharlie-machine-${basename(directory)}`)
}

function open(directory: string) {
  return openApp(directory, undefined, machineWith(machineRoot(directory), []))
}

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  try {
    run(directory)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
    rmSync(machineRoot(directory), { recursive: true, force: true })
  }
}

test('saved username, email, and team are still there the next time the window opens', () => {
  withDirectory((directory) => {
    const first = open(directory)
    first.saveProfile({
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
    })

    const reopened = open(directory)
    assert.deepEqual(reopened.profile(), {
      username: 'ada',
      email: 'ada@example.com',
      team: 'platform',
    })
  })
})

test('more than one SDK key can be saved, and exactly one is active', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })

    const keys = app.keys()
    assert.equal(keys.length, 2)
    assert.equal(keys.filter((key) => key.active).length, 1)
  })
})

test('switching the active key does not require retyping the keys that were already saved', () => {
  withDirectory((directory) => {
    const first = open(directory)
    first.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    first.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    const openai = first.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    first.activateKey(openai.id)

    const reopened = open(directory)
    const active = reopened.keys().filter((key) => key.active)
    assert.equal(active.length, 1)
    assert.equal(active[0].id, openai.id)
    assert.equal(reopened.activeKey().secret, 'sk-proj-bbbb')
  })
})

test('keys are stored in the operating system vault, and they are not written into an ordinary settings file', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })

    const settings = readFileSync(join(directory, 'settings.json'), 'utf8')
    assert.equal(settings.includes('sk-ant-api03-aaaa'), false)
    assert.equal(settings.includes('sk-proj-bbbb'), false)
    assert.equal(readdirSync(directory).some((name) => name.endsWith('.tmp')), false)
    assert.ok(readdirSync(directory).includes('settings.json'))

    const vaultId = JSON.parse(settings).vaultId as string
    const stored = listSecrets()
      .filter((credential) => credential.account.startsWith(`${vaultId}/`))
      .map((credential) => credential.password)
      .sort()
    assert.deepEqual(stored, ['sk-ant-api03-aaaa', 'sk-proj-bbbb'])

    const reopened = open(directory)
    assert.equal(reopened.activeKey().secret, 'sk-ant-api03-aaaa')
    reopened.activateKey(reopened.keys().find((key) => key.provider === 'openai')!.id)
    assert.equal(reopened.activeKey().secret, 'sk-proj-bbbb')
  })
})

test('settings with comments load, and a truncated settings file is set aside for defaults', () => {
  withDirectory((directory) => {
    const file = join(directory, 'settings.json')
    writeFileSync(file, '{\n  // my notes\n  "profile": { "username": "ada", "email": "ada@example.com", "team": "platform" }, /* trailing */\n}\n')
    assert.equal(open(directory).profile().username, 'ada')
    assert.equal(existsSync(file), true)

    writeFileSync(file, '{"profile": {"username": "ada", "ema')
    assert.deepEqual(open(directory).profile(), { username: '', email: '', team: '' })
    const names = readdirSync(directory)
    assert.equal(names.includes('settings.json'), false)
    assert.equal(names.filter((name) => name.startsWith('settings.json.') && name.endsWith('.bak')).length, 1)
  })
})

test('the first saved key stays on until the person chooses another, and clearing it leaves none active', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    assert.equal(app.keys().find((key) => key.active)?.provider, 'openai')

    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    assert.equal(app.keys().filter((key) => key.active).map((key) => key.provider).join(), 'openai')

    app.saveKey({ provider: 'copilot', secret: 'sk-copilot-dddd' })
    assert.equal(app.keys().filter((key) => key.active).map((key) => key.provider).join(), 'openai')

    const copilot = app.keys().find((key) => key.provider === 'copilot')
    assert.ok(copilot)
    app.activateKey(copilot.id)
    app.saveKey({ provider: 'cursor', secret: 'sk-cursor-eeee' })
    assert.equal(app.keys().filter((key) => key.active).map((key) => key.provider).join(), 'copilot')

    app.clearProvider()
    assert.equal(app.keys().filter((key) => key.active).length, 0)
    assert.equal(app.activeProvider(), '')
    app.saveKey({ provider: 'cursor', secret: 'sk-cursor-ffff' })
    assert.equal(app.keys().filter((key) => key.active).length, 0)

    const reopened = open(directory)
    assert.equal(reopened.keys().filter((key) => key.active).length, 0)
    assert.equal(reopened.beginLearning(), 'Turn on a provider before learning can write cards.')
    assert.equal(syncRun(reopened.runLearner()).ran, false)

    const settings = readFileSync(join(directory, 'settings.json'), 'utf8')
    assert.equal(settings.includes('sk-proj-bbbb'), false)
    assert.equal(settings.includes('sk-cursor-eeee'), false)
    assert.equal(settings.includes('sk-copilot-dddd'), false)
    assert.equal(settings.includes('createdAt'), false)
  })
})

test('Copilot has no model list, so discovery is skipped and the learner stays idle', () => {
  withDirectory((directory) => {
    let calls = 0
    const machine = machineWith(machineRoot(directory), ['cursor'])
    const app = openApp(
      directory,
      () => {
        calls += 1
        throw new Error('model was called')
      },
      machine,
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'copilot', secret: 'sk-secret-value' })
    assert.deepEqual(app.models(), [])
    assert.doesNotThrow(() => app.chosenModel())
    assert.equal(app.chosenModel(), '')
    const skipped = syncRun(app.runLearner([
      { source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' },
    ]))
    assert.equal(skipped.ran, false)
    assert.equal(skipped.model, undefined)
    assert.equal(calls, 0)
    assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8').includes('sk-secret-value'), false)
  })
})

test('a Cursor key offers the models Cursor returned and the learner uses the first', () => {
  withDirectory((directory) => {
    let calls = 0
    const machine = machineWith(machineRoot(directory), ['cursor'])
    const app = openApp(
      directory,
      () => {
        calls += 1
        return {
          scope: 'work',
          title: 'Retry a deploy',
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
        }
      },
      machine,
    )
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({
      provider: 'cursor',
      secret: 'sk-secret-value',
      account: {
        models: [
          { id: 'composer-2.5', displayName: 'Composer 2.5' },
          { id: 'auto-smart', displayName: 'Auto' },
        ],
      },
    })
    assert.deepEqual(app.models(), ['composer-2.5', 'auto-smart'])
    assert.equal(app.chosenModel(), '')
    assert.equal(app.beginLearning(), 'Choose a model before learning can write cards.')
    assert.equal(syncRun(app.runLearner()).ran, false)
    app.selectModel('composer-2.5')
    assert.equal(app.chosenModel(), 'composer-2.5')
    const ran = syncRun(app.runLearner([{ source: 'cursor', text: 'retry the deploy', repo: 'sharlie-evolved' }]))
    assert.equal(ran.ran, true)
    assert.equal(ran.model, 'composer-2.5')
    assert.equal(calls, 1)
    assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8').includes('sk-secret-value'), false)
  })
})

test('a Cursor model keeps effort and fast from its default variant until the person changes them', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({
      provider: 'cursor',
      secret: 'sk-secret-value',
      account: {
        models: [
          {
            id: 'effort-model',
            displayName: 'Effort Model',
            parameters: [
              {
                id: 'effort',
                displayName: 'Effort',
                values: [
                  { value: 'low', displayName: 'Low' },
                  { value: 'high', displayName: 'High' },
                ],
              },
              {
                id: 'fast',
                displayName: 'Fast',
                values: [
                  { value: 'false' },
                  { value: 'true' },
                ],
              },
            ],
            variants: [
              {
                params: [
                  { id: 'effort', value: 'high' },
                  { id: 'fast', value: 'true' },
                ],
                displayName: 'High',
                isDefault: true,
              },
            ],
          },
        ],
      },
    })
    assert.equal(app.beginLearning(), 'Choose a model before learning can write cards.')
    app.selectModel('effort-model')
    assert.deepEqual(app.modelParams(), [
      { id: 'effort', value: 'high' },
      { id: 'fast', value: 'true' },
    ])
    app.setModelParam('effort', 'low')
    app.setModelParam('fast', 'false')
    assert.deepEqual(app.modelParams(), [
      { id: 'effort', value: 'low' },
      { id: 'fast', value: 'false' },
    ])
    assert.equal(app.beginLearning(), '')
  })
})

test('an Anthropic key offers claude-haiku-5-5 as the default, plus claude-sonnet-5-5 and claude-opus-5-5', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })

    assert.deepEqual(app.models(), [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
    assert.equal(app.chosenModel(), 'claude-haiku-5-5')
  })
})

test('an OpenAI key offers gpt-6-luna as the default, plus gpt-6.1-sol and gpt-6-astra', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })

    assert.deepEqual(app.models(), ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'])
    assert.equal(app.chosenModel(), 'gpt-6-luna')
  })
})

test("the active key's provider selects the model list, and no other model is offered", () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })

    assert.deepEqual(app.models(), [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
    assert.throws(() => app.selectModel('gpt-6-luna'), /not offered/)

    const openai = app.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    app.activateKey(openai.id)

    assert.deepEqual(app.models(), ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'])
    assert.equal(app.chosenModel(), 'gpt-6-luna')
    assert.throws(() => app.selectModel('claude-opus-5-5'), /not offered/)
  })
})

test('the model chosen in the app is the model that writes cards and answers lookups', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    app.selectModel('claude-sonnet-5-5')

    const reopened = open(directory)
    assert.equal(reopened.chosenModel(), 'claude-sonnet-5-5')
    assert.equal(syncRun(reopened.runLearner()).model, 'claude-sonnet-5-5')
    assert.equal(reopened.answerLookup().model, 'claude-sonnet-5-5')

    const openai = reopened.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    reopened.activateKey(openai.id)
    assert.equal(reopened.chosenModel(), 'gpt-6-luna')
    assert.equal(syncRun(reopened.runLearner()).model, 'gpt-6-luna')
  })
})

test('the learner interval defaults to 30 minutes', () => {
  withDirectory((directory) => {
    const app = open(directory)
    assert.equal(app.learnerInterval(), 30 * 60 * 1000)
  })
})

test('the publisher interval defaults to 30 minutes', () => {
  withDirectory((directory) => {
    const app = open(directory)
    assert.equal(app.publisherInterval(), 30 * 60 * 1000)
  })
})

test('the learner interval accepts 15 minutes, 30 minutes, 1 hour, and manual', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.setLearnerInterval(15 * 60 * 1000)
    app.setLearnerInterval(30 * 60 * 1000)
    app.setLearnerInterval(60 * 60 * 1000)
    app.setLearnerInterval(0)
    assert.equal(app.learnerInterval(), 0)
    assert.throws(() => app.setLearnerInterval(60 * 60 * 1000 - 1), /15 minutes, 30 minutes, 1 hour, or manual/)
    assert.throws(() => app.setLearnerInterval(2 * 60 * 60 * 1000), /15 minutes, 30 minutes, 1 hour, or manual/)
    assert.equal(app.learnerInterval(), 0)

    app.setLearnerInterval(30 * 60 * 1000)
    const reopened = open(directory)
    assert.equal(reopened.learnerInterval(), 30 * 60 * 1000)
  })
})

test('the publisher interval accepts 15 minutes, 30 minutes, 1 hour, and manual', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.setPublisherInterval(15 * 60 * 1000)
    assert.equal(app.publisherInterval(), 15 * 60 * 1000)
    assert.equal(app.learnerInterval(), 30 * 60 * 1000)
    assert.throws(() => app.setPublisherInterval(60 * 60 * 1000 - 1), /15 minutes, 30 minutes, 1 hour, or manual/)
    assert.equal(app.publisherInterval(), 15 * 60 * 1000)

    app.setPublisherInterval(0)
    app.setPublisherInterval(60 * 60 * 1000)
    const reopened = open(directory)
    assert.equal(reopened.publisherInterval(), 60 * 60 * 1000)
  })
})

test('the learner does not run when username, email, or team is missing', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })

    for (const profile of [
      { username: '', email: 'ada@example.com', team: 'platform' },
      { username: 'ada', email: '', team: 'platform' },
      { username: 'ada', email: 'ada@example.com', team: '' },
    ]) {
      app.saveProfile(profile)
      const skipped = syncRun(app.runLearner())
      assert.equal(skipped.ran, false)
      assert.equal(skipped.model, undefined)
    }

    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    assert.equal(syncRun(app.runLearner()).ran, true)
  })
})

test('the learner does not run when no active key is saved', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })

    const skipped = syncRun(app.runLearner())
    assert.equal(skipped.ran, false)
    assert.equal(skipped.model, undefined)

    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    const ran = syncRun(app.runLearner())
    assert.equal(ran.ran, true)
    assert.equal(ran.model, 'gpt-6-luna')
  })
})
