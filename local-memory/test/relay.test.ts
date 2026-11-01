import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { cardCypher, type RelayCard } from '../relay/cypher.ts'
import { googleAccessToken, listChildren, moveFile, readFileText, type DriveItem } from '../relay/drive.ts'
import { relayDropzone, runRelay } from '../relay/relay.ts'

const transcript = 'SECRET TRANSCRIPT do not upload'

function fixture(): RelayCard & { transcript: string; failure_modes: string[] } {
  return {
    id: 'card_20261031_120000',
    title: 'Retry failed deploys',
    solution: 'Retry the deploy once, then read the log.',
    created_at: '2026-10-31T12:00:00.000Z',
    sources: ['cursor'],
    author: { username: 'ada', email: 'ada@example.com', team: 'platform' },
    failure_modes: ['A deploy failed after the lock timed out.'],
    transcript,
    relations: [
      { entity: 'Retry failed deploys', relation: 'APPLIES_TO', target_entity: 'cursor' },
      { entity: 'Retry failed deploys', relation: 'RESOLVES', target_entity: 'lock-timeout' },
      { entity: 'Retry failed deploys', relation: 'WARNS_AGAINST', target_entity: 'editing-config-first' },
      { entity: 'lock-timeout', relation: 'OCCURS_IN', target_entity: 'cursor' },
      { entity: 'cursor', relation: 'INCOMPATIBLE_WITH', target_entity: 'old-cli' },
    ],
  }
}

test('a fixture card becomes idempotent MERGE statements and drops transcript text', () => {
  const card = fixture()
  const statements = cardCypher(card)
  assert.deepEqual(cardCypher(card), statements)
  const cypher = statements.map((statement) => statement.statement).join('\n')
  const parameters = statements.flatMap((statement) => Object.values(statement.parameters))
  assert.match(cypher, /MERGE \(developer:Developer \{id: \$developerId\}\)/)
  assert.match(cypher, /MERGE \(card:Card \{id: \$cardId\}\)/)
  assert.match(cypher, /SET card\.id = \$cardId, card\.title = \$title, card\.solution = \$solution, card\.created_at = \$createdAt, card\.source_type = \$sourceType/)
  assert.match(cypher, /MERGE \(developer\)-\[:AUTHORED\]->\(card\)/)
  assert.match(cypher, /MERGE \(card\)-\[:APPLIES_TO\]->\(tool\)/)
  assert.match(cypher, /MERGE \(card\)-\[:RESOLVES\]->\(issue\)/)
  assert.match(cypher, /MERGE \(card\)-\[:WARNS_AGAINST\]->\(pattern\)/)
  assert.match(cypher, /MERGE \(issue\)-\[:OCCURS_IN\]->\(tool\)/)
  assert.match(cypher, /MERGE \(left\)-\[:INCOMPATIBLE_WITH\]->\(right\)/)
  assert.equal(cypher.includes('CREATE'), false)
  for (const value of [
    card.id,
    'developer:ada@example.com',
    'tool:cursor',
    'issue:lock-timeout',
    'antipattern:editing-config-first',
    'tool:old-cli',
    'cursor',
  ]) {
    assert.equal(parameters.includes(value), true, value)
  }
  const packed = JSON.stringify(statements)
  assert.equal(packed.includes(transcript), false)
  assert.equal(packed.includes('failure_modes'), false)
  assert.equal(packed.includes('A deploy failed after the lock timed out.'), false)
})

test('card cypher skips tool-call sources and still links the learning source', () => {
  const card = fixture()
  card.sources = ['Read', 'Shell', 'cursor']
  card.relations = [
    ...(card.relations ?? []),
    { entity: 'Retry failed deploys', relation: 'APPLIES_TO', target_entity: 'App.tsx' },
    { entity: 'Retry failed deploys', relation: 'RESOLVES', target_entity: 'src/index.ts' },
  ]
  const statements = cardCypher(card)
  const parameters = statements.flatMap((statement) => Object.values(statement.parameters))
  assert.equal(parameters.includes('Read'), false)
  assert.equal(parameters.includes('Shell'), false)
  assert.equal(parameters.includes('App.tsx'), false)
  assert.equal(parameters.includes('src/index.ts'), false)
  assert.equal(parameters.includes('cursor'), true)
  assert.equal(parameters.includes('tool:cursor'), true)
  assert.match(statements.map((statement) => statement.statement).join('\n'), /MERGE \(card\)-\[:APPLIES_TO\]->\(tool\)/)
})

test('the dropzone runner writes Cypher for username card JSON and moves that file', async () => {
  const reads: string[] = []
  const moves: { fileId: string; fromId: string; toId: string }[] = []
  const writes: string[] = []
  const folders: Record<string, DriveItem[]> = {
    drop: [
      { id: 'ada', name: 'ada', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'done', name: '_Processed', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'loose', name: 'notes.md', mimeType: 'text/markdown' },
    ],
    ada: [
      { id: 'cardfile', name: 'card_20261031_120000.json', mimeType: 'application/json' },
      { id: 'markdown', name: 'card_20261031_120000.md', mimeType: 'text/markdown' },
    ],
    done: [{ id: 'old', name: 'old.json', mimeType: 'application/json' }],
  }
  const result = await relayDropzone({
    rootId: 'drop',
    listChildren: async (folderId) => folders[folderId] ?? [],
    readText: async (fileId) => {
      reads.push(fileId)
      return JSON.stringify(fixture())
    },
    move: async (fileId, fromId, toId) => {
      moves.push({ fileId, fromId, toId })
    },
    ensureFolder: async () => {
      throw new Error('processed folder already exists')
    },
    write: async (statements) => {
      writes.push(JSON.stringify(statements))
    },
  })
  assert.deepEqual(reads, ['cardfile'])
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.includes(transcript), false)
  assert.deepEqual(moves, [{ fileId: 'cardfile', fromId: 'ada', toId: 'done' }])
  assert.deepEqual(result, { processed: ['card_20261031_120000.json'], skipped: [] })
})

test('drive requests read and move files without uploading card text', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const calls: { url: string; method: string; body: string }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const body =
      typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : ''
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'token' }))
    if (url.includes('alt=media')) return new Response('{"solution":"kept on drive"}')
    return new Response(JSON.stringify({ id: 'file', files: [] }))
  }
  const token = await googleAccessToken(
    JSON.stringify({ client_email: 'relay@example.iam.gserviceaccount.com', private_key: pem }),
    fetchImpl,
  )
  assert.equal(token, 'token')
  await listChildren(token, 'dropzone-id', fetchImpl)
  await readFileText(token, 'file-id', fetchImpl)
  await moveFile(token, 'file-id', 'ada-id', 'processed-id', fetchImpl)
  assert.equal(decodeURIComponent(calls[0]?.body ?? '').includes('urn:ietf:params:oauth:grant-type:jwt-bearer'), true)
  assert.equal(calls.some((call) => call.url.includes('dropzone-id')), true)
  assert.equal(calls.some((call) => call.method === 'GET' && call.url.includes('alt=media')), true)
  assert.equal(
    calls.some((call) => call.method === 'PATCH' && call.url.includes('addParents=processed-id') && call.url.includes('removeParents=ada-id')),
    true,
  )
  assert.equal(calls.some((call) => call.body.includes('kept on drive')), false)
})

test('the runner refuses to start without its environment names', async () => {
  await assert.rejects(
    () => runRelay({}),
    /NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, DRIVE_FOLDER_ID, and GOOGLE_SERVICE_ACCOUNT_JSON are required/,
  )
})
