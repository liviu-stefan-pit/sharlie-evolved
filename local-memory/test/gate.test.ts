import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { findCredentials } from '@napi-rs/keyring'
import { discardVault, openApp } from '../src/app.ts'
import { machineWith } from './machine.ts'

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
    assert.deepEqual(readdirSync(directory), ['settings.json'])

    const vaultId = JSON.parse(settings).vaultId as string
    const stored = findCredentials('sharlie-local-memory')
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

test('an OpenAI key offers gpt-6-luna as the default, plus gpt-6-sol and gpt-6-astra', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })

    assert.deepEqual(app.models(), ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'])
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

    assert.deepEqual(app.models(), ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'])
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
    assert.equal(reopened.runLearner().model, 'claude-sonnet-5-5')
    assert.equal(reopened.answerLookup().model, 'claude-sonnet-5-5')

    const openai = reopened.keys().find((key) => key.provider === 'openai')
    assert.ok(openai)
    reopened.activateKey(openai.id)
    assert.equal(reopened.chosenModel(), 'gpt-6-luna')
    assert.equal(reopened.runLearner().model, 'gpt-6-luna')
  })
})

test('the learner interval defaults to one hour', () => {
  withDirectory((directory) => {
    const app = open(directory)
    assert.equal(app.learnerInterval(), 60 * 60 * 1000)
  })
})

test('the publisher interval defaults to one hour', () => {
  withDirectory((directory) => {
    const app = open(directory)
    assert.equal(app.publisherInterval(), 60 * 60 * 1000)
  })
})

test('the window refuses a learner interval shorter than one hour', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.setLearnerInterval(2 * 60 * 60 * 1000)
    assert.throws(() => app.setLearnerInterval(60 * 60 * 1000 - 1), /hour/)
    assert.equal(app.learnerInterval(), 2 * 60 * 60 * 1000)

    app.setLearnerInterval(60 * 60 * 1000)
    const reopened = open(directory)
    assert.equal(reopened.learnerInterval(), 60 * 60 * 1000)
  })
})

test('the window refuses a publisher interval shorter than one hour', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.setPublisherInterval(2 * 60 * 60 * 1000)
    assert.throws(() => app.setPublisherInterval(60 * 60 * 1000 - 1), /hour/)
    assert.equal(app.publisherInterval(), 2 * 60 * 60 * 1000)
    assert.equal(app.learnerInterval(), 60 * 60 * 1000)

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
      const skipped = app.runLearner()
      assert.equal(skipped.ran, false)
      assert.equal(skipped.model, undefined)
    }

    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    assert.equal(app.runLearner().ran, true)
  })
})

test('the learner does not run when no active key is saved', () => {
  withDirectory((directory) => {
    const app = open(directory)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })

    const skipped = app.runLearner()
    assert.equal(skipped.ran, false)
    assert.equal(skipped.model, undefined)

    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    const ran = app.runLearner()
    assert.equal(ran.ran, true)
    assert.equal(ran.model, 'gpt-6-luna')
  })
})
