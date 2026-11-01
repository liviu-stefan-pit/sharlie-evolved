import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { discardVault, openApp, type LessonDraft, type Transcript } from '../src/app.ts'
import { machineWith } from './machine.ts'

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'sharlie-'))
  try {
    run(directory)
  } finally {
    discardVault(directory)
    rmSync(directory, { recursive: true, force: true })
  }
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

function ready(directory: string, complete: (request: { model: string; transcript: Transcript; transcripts: Transcript[]; projects: string[]; cards: { id: string; topics: string[] }[] }) => LessonDraft) {
  const app = openApp(directory, complete, machineWith(directory, ['cursor', 'claude']))
  app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
  app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
  return app
}

const transcript: Transcript = {
  source: 'cursor',
  text: 'the deploy failed after the lock timed out',
  repo: 'sharlie-evolved',
}

test('one transcript becomes one markdown card with the lesson and its front matter', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    const result = app.runLearner([transcript])

    assert.equal(result.ran, true)
    const files = cardFiles(directory)
    assert.equal(files.length, 1)
    const text = readFileSync(join(directory, 'cards', files[0]), 'utf8')
    const json = JSON.parse(readFileSync(join(directory, 'cards', files[0].replace(/\.md$/, '.json')), 'utf8')) as {
      id: string
      title: string
      solution: string
    }
    const id = files[0].match(/^(card_\d{8}_\d{6}(?:_\d+)?)\.md$/)?.[1]
    assert.ok(id)
    assert.equal(json.id, id)
    assert.match(text, new RegExp(`id: ${id}`))
    assert.match(text, /username: ada/)
    assert.match(text, /email: ada@example.com/)
    assert.match(text, /team: platform/)
    assert.match(text, /- cursor/)
    assert.match(text, /framework: sharlie-evolved/)
    assert.match(text, /title: Retry failed deploys/)
    assert.equal(json.title, 'Retry failed deploys')
    assert.match(text, /## Solution\n\nRetry the deploy once, then read the log\./)
    assert.match(text, /## Failure modes\n\nA deploy failed after the lock timed out\./)
    assert.match(text, /The lock clears on its own within a minute\./)
    assert.match(text, /When a deploy fails on a lock, retry once before changing config\./)
    assert.equal(readdirSync(join(directory, 'inbox')).length, 0)
    assert.equal(existsSync(join(directory, 'personal')), false)
    assert.equal(existsSync(join(directory, 'work')), false)
  })
})

function words(count: number) {
  return Array.from({ length: count }, () => 'word').join(' ')
}

test('a private lesson and a reusable lesson both land in cards', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ scope: 'personal', title: 'My scratch note' }))
    app.runLearner([transcript])
    assert.deepEqual(cardFiles(directory).length, 1)
    assert.match(cardText(directory), /title: My scratch note/)
    assert.equal(existsSync(join(directory, 'personal')), false)
    assert.equal(existsSync(join(directory, 'work')), false)
  })
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    app.runLearner([transcript, { ...transcript, text: 'read the log next' }])
    const files = cardFiles(directory)
    assert.equal(files.length, 2)
    assert.equal(new Set(files).size, 2)
    const texts = files.map((name) => readFileSync(join(directory, 'cards', name), 'utf8'))
    assert.equal(texts.every((text) => text.includes('username: ada')), true)
    assert.equal(existsSync(join(directory, 'personal')), false)
    assert.equal(existsSync(join(directory, 'work')), false)
  })
  withDirectory((directory) => {
    const app = openApp(directory, () => draft(), machineWith(directory, ['cursor', 'claude']))
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'reliability' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    app.runLearner([transcript])
    assert.equal(cardFiles(directory).length, 1)
    assert.match(cardText(directory), /team: reliability/)
  })
})

test('the filename is a readable name, unique in its folder, ending with the card id', () => {
  withDirectory((directory) => {
    let call = 0
    const app = ready(directory, () => {
      call += 1
      return draft({ title: call === 1 ? 'Retry failed deploys' : 'Read the lock log' })
    })
    app.runLearner([transcript, { ...transcript, source: 'claude', text: 'read the log' }])
    const files = cardFiles(directory)
    assert.equal(files.length, 2)
    assert.equal(new Set(files).size, 2)
    for (const file of files) {
      const id = file.match(/^(card_\d{8}_\d{6}(?:_\d+)?)\.md$/)
      assert.ok(id)
      const card = readFileSync(join(directory, 'cards', file), 'utf8')
      assert.match(card, new RegExp(`^id: ${id[1]}$`, 'm'))
    }
    const texts = files.map((file) => readFileSync(join(directory, 'cards', file), 'utf8'))
    assert.equal(texts.some((text) => text.includes('title: Retry failed deploys')), true)
    assert.equal(texts.some((text) => text.includes('title: Read the lock log')), true)
    assert.equal(texts.some((text) => text.includes('- claude')), true)
  })
})

test('at is the UTC time on the card', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    const before = Date.now()
    app.runLearner([transcript])
    const after = Date.now()
    const card = cardText(directory)
    const at = card.match(/^created_at: (.+)$/m)?.[1]
    assert.ok(at)
    assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const stamped = Date.parse(at)
    assert.equal(stamped >= before && stamped <= after, true)
  })
})

test('author username, email, and team are copied from the saved profile', () => {
  withDirectory((directory) => {
    const app = openApp(directory, () => draft(), machineWith(directory, ['cursor', 'claude']))
    app.saveProfile({ username: 'grace', email: 'grace@example.com', team: 'reliability' })
    app.saveKey({ provider: 'openai', secret: 'sk-proj-bbbb' })
    app.runLearner([transcript])
    const card = cardText(directory)
    assert.match(card, /username: grace/)
    assert.match(card, /email: grace@example.com/)
    assert.match(card, /team: reliability/)
  })
})

function cardFiles(directory: string) {
  const folder = join(directory, 'cards')
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => /^card_\d{8}_\d{6}(?:_\d+)?\.md$/.test(name))
    .sort()
}

function cardText(directory: string) {
  const files = cardFiles(directory)
  return readFileSync(join(directory, 'cards', files[0]), 'utf8')
}

test('when the knowledge has no matching project, project is the repo the tool recorded', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        belongsToProject: 'missing',
        subjectProject: 'Sharlie',
        clearlyOneProduct: true,
      }),
    )
    app.runLearner([transcript])
    assert.match(cardText(directory), /^  framework: sharlie-evolved$/m)
  })
})

test('a general technique, and a chat that is not about one product, sets project to none', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        generalTechnique: true,
        clearlyOneProduct: false,
        subjectProject: 'retrying',
        belongsToProject: null,
      }),
    )
    app.runLearner([transcript])
    assert.match(cardText(directory), /^  framework: none$/m)
  })
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        generalTechnique: false,
        clearlyOneProduct: false,
        subjectProject: 'retrying',
      }),
    )
    app.runLearner([{ source: 'cursor', text: 'how do I name a test' }])
    assert.match(cardText(directory), /^  framework: none$/m)
  })
})

test('when the tool recorded no repo, a clear subject becomes the project and that spelling is reused', () => {
  withDirectory((directory) => {
    let call = 0
    const app = ready(directory, () => {
      call += 1
      return draft({
        title: call === 1 ? 'Retry failed deploys' : 'Read the lock log',
        belongsToProject: null,
        clearlyOneProduct: true,
        subjectProject: call === 1 ? 'ledger' : 'Ledger',
        generalTechnique: false,
      })
    })
    app.runLearner([{ source: 'cursor', text: 'the ledger export failed' }])
    app.runLearner([{ source: 'cursor', text: 'the ledger export needs a header' }])
    const folder = join(directory, 'cards')
    const cards = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(cards.filter((card) => /^  framework: ledger$/m.test(card)).length, 2)
  })
})

test('project reuses an existing knowledge project when the lesson belongs to it', () => {
  withDirectory((directory) => {
    let call = 0
    const seen: string[][] = []
    const app = ready(directory, (request) => {
      seen.push(request.projects)
      call += 1
      if (call === 1) return draft()
      return draft({
        title: 'Read the lock log',
        belongsToProject: 'Sharlie-Evolved',
        subjectProject: 'Sharlie',
        clearlyOneProduct: true,
      })
    })
    app.runLearner([transcript])
    app.runLearner([{ source: 'cursor', text: 'read the log' }])
    assert.deepEqual(seen[1], ['sharlie-evolved'])
    const folder = join(directory, 'cards')
    const cards = readdirSync(folder).map((file) => readFileSync(join(folder, file), 'utf8'))
    assert.equal(cards.filter((card) => /^  framework: sharlie-evolved$/m.test(card)).length, 2)
  })
})

test('the summary and the lesson stay in the language of the source chat', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        title: 'Reîncearcă deploy-ul',
        topics: ['deploy'],
        summary: 'Reîncearcă o dată deploy-ul eșuat.',
        situation: 'Deploy-ul a eșuat după ce lacătul a expirat.',
        whatToDo: 'Reîncearcă deploy-ul o dată, apoi citește jurnalul.',
        why: 'Lacătul se eliberează singur într-un minut.',
        apply:
          'Când un deploy eșuează pe lacăt, reîncearcă o dată înainte să schimbi configurația.',
      }),
    )
    app.runLearner([{ ...transcript, text: 'Deploy-ul a eșuat după ce lacătul a expirat.' }])
    const card = cardText(directory)
    assert.match(card, /title: Reîncearcă deploy-ul/)
    assert.match(card, /## Solution\n\nReîncearcă deploy-ul o dată, apoi citește jurnalul\./)
    assert.match(card, /## Failure modes\n\nDeploy-ul a eșuat după ce lacătul a expirat\./)
    assert.match(card, /Lacătul se eliberează singur într-un minut\./)
    assert.match(card, /Când un deploy eșuează pe lacăt, reîncearcă o dată înainte să schimbi configurația\./)
  })
})

test('each of the four lesson parts stays within 120 words', () => {
  for (const part of ['situation', 'whatToDo', 'why', 'apply'] as const) {
    withDirectory((directory) => {
      const app = ready(directory, () => draft({ [part]: words(121) }))
      app.runLearner([transcript])
      assert.equal(cardFiles(directory).length, 0)
    })
  }
  withDirectory((directory) => {
    const text = words(120)
    const app = ready(directory, () =>
      draft({ situation: text, whatToDo: text, why: text, apply: text }),
    )
    app.runLearner([transcript])
    const card = cardText(directory)
    const body = card.split('---').at(-1) ?? ''
    assert.equal(body.split('word').length - 1, 480)
  })
})

test('the summary is one or two sentences', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ summary: 'One. Two. Three.' }))
    app.runLearner([transcript])
    assert.equal(cardFiles(directory).length, 0)
  })
  for (const summary of ['Retry a failed deploy once.', 'Retry once. Then read the log.']) {
    withDirectory((directory) => {
      const app = ready(directory, () => draft({ summary }))
      app.runLearner([transcript])
      assert.equal(cardFiles(directory).length, 1)
      assert.match(cardText(directory), /## Solution\n\nRetry the deploy once, then read the log\./)
    })
  }
})

test('the stored card has other names removed and secrets redacted', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        title: 'Grace Hopper left sk-ant-api03-supersecret in sharlie-evolved',
        topics: ['deploys', 'Grace Hopper'],
        summary: 'Retry a failed deploy once.',
        situation: 'Grace Hopper pasted password: hunter2 beside ada@example.com.',
        whatToDo: 'Keep the project sharlie-evolved and run if (ready) retry(build).',
        why: 'The lock belongs to platform and ada.',
        apply: 'A teammate retries without ghp_abcdefghijklmnopqrstuvwxyz.',
        otherNames: ['Grace Hopper', 'ada', 'platform', 'ada@example.com'],
      }),
    )
    app.runLearner([transcript])
    const card = cardText(directory)
    assert.equal(card.includes('Grace Hopper'), false)
    assert.equal(card.includes('sk-ant-api03-supersecret'), false)
    assert.equal(card.includes('hunter2'), false)
    assert.equal(card.includes('ghp_'), false)
    assert.match(card, /A teammate retries without \[redacted\]\./)
    assert.match(card, /title: "left \[redacted\] in sharlie-evolved"/)
    assert.equal(card.includes('Grace'), false)
    assert.match(card, /pasted password: \[redacted\] beside ada@example.com\./)
    assert.match(card, /Keep the project sharlie-evolved and run if \(ready\) retry\(build\)\./)
    assert.match(card, /The lock belongs to platform and ada\./)
    assert.match(card, /username: ada/)
    assert.match(card, /email: ada@example.com/)
    assert.match(card, /team: platform/)
  })
})

test('a card missing any required field is left unwritten', () => {
  const incomplete: Partial<LessonDraft>[] = [
    { title: '  ' },
    { topics: [] },
    { topics: [''] },
    { summary: '' },
    { situation: '' },
    { whatToDo: '' },
    { why: '' },
    { apply: '' },
    { scope: 'later' as LessonDraft['scope'] },
  ]
  for (const overrides of incomplete) {
    withDirectory((directory) => {
      const app = ready(directory, () => draft(overrides))
      const learned = app.runLearner([transcript])
      assert.equal(learned.ran, true)
      assert.equal(cardFiles(directory).length, 0)
    })
  }
  withDirectory((directory) => {
    const app = ready(directory, () => draft())
    app.runLearner([{ ...transcript, source: '' }])
    assert.equal(cardFiles(directory).length, 0)
  })
  withDirectory((directory) => {
    const app = ready(directory, () => ({ ...draft(), title: undefined as unknown as string }))
    app.runLearner([transcript])
    assert.equal(cardFiles(directory).length, 0)
  })
})

test('the learner writes nothing until a profile and an active key are saved', () => {
  withDirectory((directory) => {
    let calls = 0
    const app = openApp(
      directory,
      () => {
        calls += 1
        return draft()
      },
      machineWith(directory, ['cursor', 'claude']),
    )
    assert.equal(app.runLearner([transcript]).ran, false)
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    assert.equal(app.runLearner([transcript]).ran, false)
    assert.equal(calls, 0)
    assert.equal(cardFiles(directory).length, 0)
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    assert.equal(app.runLearner([transcript]).ran, true)
    assert.equal(calls, 1)
    assert.equal(cardFiles(directory).length, 1)
  })
})

test('a workspace name is the project when the tool recorded no repo', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ belongsToProject: null, subjectProject: null }))
    app.runLearner([{ source: 'cursor', text: 'the export failed', workspace: 'ledger' }])
    assert.match(cardText(directory), /^  framework: ledger$/m)
  })
})

test('other names are removed even when they are not plain ascii', () => {
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({
        title: 'José left the deploy note',
        otherNames: ['José'],
      }),
    )
    app.runLearner([transcript])
    const card = cardText(directory)
    assert.equal(card.includes('José'), false)
    assert.match(card, /title: left the deploy note/)
  })
})

test('the filename keeps a readable name from the lesson title', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ title: 'Reîncearcă deploy-ul' }))
    app.runLearner([transcript])
    const file = cardFiles(directory)[0]
    assert.match(file, /^card_\d{8}_\d{6}(?:_\d+)?\.md$/)
    assert.match(cardText(directory), /title: Reîncearcă deploy-ul/)
  })
})

test('project names and code stay on the card', () => {
  withDirectory((directory) => {
    let call = 0
    const app = ready(directory, () => {
      call += 1
      if (call === 1) return draft({ title: 'Export the ledger' })
      return draft({
        title: 'Name a test',
        generalTechnique: true,
        clearlyOneProduct: false,
        subjectProject: null,
        belongsToProject: null,
        otherNames: ['ledger', 'retry'],
        whatToDo: 'Use ledger and run `retry(build)` once.',
      })
    })
    app.runLearner([{ source: 'cursor', text: 'export', repo: 'ledger' }])
    app.runLearner([{ source: 'cursor', text: 'how do I name a test' }])
    const note = cardFiles(directory)
      .map((file) => readFileSync(join(directory, 'cards', file), 'utf8'))
      .find((card) => card.includes('Name a test'))
    assert.ok(note)
    assert.match(note, /Use ledger and run `retry\(build\)` once\./)
    assert.match(note, /^  framework: none$/m)
  })
})

test('github, slack, aws, and jwt secrets are replaced with redacted', () => {
  const secrets = [
    'github_pat_ABCDEFGHIJKLMNOPQRSTUV',
    'xoxb-1234567890-abcdefghij',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ]
  withDirectory((directory) => {
    const app = ready(directory, () =>
      draft({ whatToDo: `Drop ${secrets.join(' ')} and keep retry(build).` }),
    )
    app.runLearner([transcript])
    const card = cardText(directory)
    for (const secret of secrets) assert.equal(card.includes(secret), false)
    assert.match(card, /Drop \[redacted\] \[redacted\] \[redacted\] \[redacted\] and keep retry\(build\)\./)
  })
})

test('a title with no letters is still filed under a readable name', () => {
  withDirectory((directory) => {
    const app = ready(directory, () => draft({ title: '!!!' }))
    app.runLearner([transcript])
    const file = cardFiles(directory)[0]
    assert.match(file, /^card_\d{8}_\d{6}(?:_\d+)?\.md$/)
  })
})

test('the learner does not write a card when no model is connected', () => {
  withDirectory((directory) => {
    const app = openApp(directory, undefined, machineWith(directory, ['cursor', 'claude']))
    app.saveProfile({ username: 'ada', email: 'ada@example.com', team: 'platform' })
    app.saveKey({ provider: 'anthropic', secret: 'sk-ant-api03-aaaa' })
    assert.throws(() => app.runLearner([transcript]), /model/)
    assert.equal(existsSync(join(directory, 'work')), false)
  })
})

test('one learning pass reads every enabled source before it writes a card', () => {
  withDirectory((directory) => {
    const batches: string[][] = []
    let wroteDuringRead = false
    const app = ready(directory, (request) => {
      batches.push(request.transcripts.map((item) => `${item.source}:${item.text}`))
      wroteDuringRead =
        existsSync(join(directory, 'work')) || existsSync(join(directory, 'personal'))
      return draft({
        title: request.transcript.text === 'the deploy failed' ? 'Retry failed deploys' : 'Read the lock log',
      })
    })
    app.runLearner([
      { source: 'cursor', text: 'the deploy failed', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'read the log' },
      { source: 'copilot', text: 'this tool is not installed' },
    ])
    assert.equal(wroteDuringRead, false)
    assert.deepEqual(batches, [
      ['cursor:the deploy failed', 'claude:read the log'],
      ['cursor:the deploy failed', 'claude:read the log'],
    ])
    assert.equal(cardFiles(directory).length, 2)
  })
})

test('the same claim found in two tools becomes one card that lists both sources', () => {
  withDirectory((directory) => {
    const app = ready(directory, (request) => {
      if (request.transcript.source === 'claude') return draft({ sameClaim: true })
      return draft({ sources: ['cursor', 'claude'] })
    })
    app.runLearner([
      { source: 'cursor', text: 'retry the deploy once', repo: 'sharlie-evolved' },
      { source: 'claude', text: 'retry that deploy one time' },
    ])
    const files = cardFiles(directory)
    assert.equal(files.length, 1)
    const card = readFileSync(join(directory, 'cards', files[0]), 'utf8')
    assert.match(card, /- cursor/)
    assert.match(card, /- claude/)
  })
})

test('a chat that repeats a known claim rewrites that card in place', () => {
  withDirectory((directory) => {
    let pass = 0
    const app = ready(directory, (request) => {
      pass += 1
      if (pass === 1) return draft({ situation: 'A deploy failed after the lock timed out.' })
      return draft({
        updateId: request.cards[0].id,
        situation: 'A deploy failed, so retry it once.',
        whatToDo: 'Retry once.',
        why: 'The lock clears within a minute.',
        apply: 'Retry a locked deploy once.',
      })
    })
    app.runLearner([transcript])
    const before = cardFiles(directory)
    const beforeText = readFileSync(join(directory, 'cards', before[0]), 'utf8')
    const id = beforeText.match(/^id: (.+)$/m)?.[1]
    app.runLearner([{ source: 'cursor', text: 'retry the same failed deploy' }])
    assert.deepEqual(cardFiles(directory), before)
    const card = readFileSync(join(directory, 'cards', before[0]), 'utf8')
    assert.match(card, new RegExp(`^id: ${id}$`, 'm'))
    assert.match(card, /## Failure modes\n\nA deploy failed, so retry it once\./)
    assert.equal(card.includes('A deploy failed after the lock timed out.'), false)
    const archived = readdirSync(join(directory, 'archive')).filter((name) => name.endsWith('.md'))
    assert.equal(archived.length, 1)
    assert.match(readFileSync(join(directory, 'archive', archived[0]), 'utf8'), /A deploy failed after the lock timed out\./)
  })
})

test('a rewrite stays within 120 words for each lesson part and does not append', () => {
  withDirectory((directory) => {
    let pass = 0
    const short = 'Retry the deploy once.'
    const fitted = words(120)
    const tooLong = words(121)
    const app = ready(directory, (request) => {
      pass += 1
      if (pass === 1) return draft({ situation: short })
      if (pass === 2) return draft({ updateId: request.cards[0].id, situation: fitted })
      return draft({ updateId: request.cards[0].id, situation: `${fitted} ${tooLong}` })
    })
    app.runLearner([transcript])
    app.runLearner([{ source: 'cursor', text: 'say the claim again' }])
    const file = cardFiles(directory)[0]
    const replaced = readFileSync(join(directory, 'cards', file), 'utf8')
    assert.match(replaced, new RegExp(`## Failure modes\\n\\n${fitted}\\n`))
    assert.equal(replaced.includes(`## Failure modes\n\n${short}`), false)
    app.runLearner([{ source: 'cursor', text: 'say the claim at more length' }])
    const kept = readFileSync(join(directory, 'cards', file), 'utf8')
    assert.equal(cardFiles(directory).length, 1)
    assert.match(kept, new RegExp(`## Failure modes\\n\\n${fitted}\\n`))
    assert.equal(kept.includes(tooLong), false)
  })
})

test('a different claim creates a new card that shares a topic and stays separate', () => {
  withDirectory((directory) => {
    let pass = 0
    const app = ready(directory, (request) => {
      pass += 1
      if (pass === 1) return draft({ title: 'Retry failed deploys', topics: ['deploys'] })
      assert.equal(request.cards[0].title, 'Retry failed deploys')
      return draft({
        title: 'Read the lock log',
        topics: ['deploys', 'logs'],
        summary: 'Read the log after one failed deploy.',
      })
    })
    app.runLearner([transcript])
    app.runLearner([{ source: 'cursor', text: 'then read the log' }])
    const files = cardFiles(directory)
    assert.equal(files.length, 2)
    const cards = files.map((file) => readFileSync(join(directory, 'cards', file), 'utf8'))
    assert.equal(cards.some((card) => card.includes('title: Retry failed deploys')), true)
    assert.equal(cards.some((card) => card.includes('title: Read the lock log')), true)
    const ids = cards.map((card) => card.match(/^id: (.+)$/m)?.[1])
    assert.equal(new Set(ids).size, 2)
  })
})

test('a repeat from a second tool adds that tool to the card sources', () => {
  withDirectory((directory) => {
    let pass = 0
    const app = ready(directory, (request) => {
      pass += 1
      if (pass === 1) return draft()
      return draft({ updateId: request.cards[0].id })
    })
    app.runLearner([transcript])
    app.runLearner([{ source: 'claude', text: 'retry the deploy once' }])
    assert.equal(cardFiles(directory).length, 1)
    const card = cardText(directory)
    assert.match(card, /- cursor/)
    assert.match(card, /- claude/)
  })
})

test('the model chosen in the app is the one asked to write the card', () => {
  withDirectory((directory) => {
    let asked = ''
    const app = ready(directory, (request) => {
      asked = request.model
      return draft()
    })
    app.selectModel('claude-opus-5-5')
    app.runLearner([transcript])
    assert.equal(asked, 'claude-opus-5-5')
  })
})
