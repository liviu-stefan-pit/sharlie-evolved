import { cardCypher, cardFromUnknown, type CypherStatement } from './cypher.ts'
import { createFolder, googleAccessToken, isFolder, listChildren, moveFile, readFileText, type DriveItem } from './drive.ts'
import { writeCypher } from './neo4j.ts'

export type RelayDeps = {
  rootId: string
  listChildren(folderId: string): Promise<DriveItem[]>
  readText(fileId: string): Promise<string>
  move(fileId: string, fromId: string, toId: string): Promise<void>
  ensureFolder(name: string, parentId: string): Promise<DriveItem>
  write(statements: CypherStatement[]): Promise<void>
}

function isCardJson(item: DriveItem) {
  return item.name.toLowerCase().endsWith('.json') && !isFolder(item)
}

export async function relayDropzone(deps: RelayDeps) {
  const children = await deps.listChildren(deps.rootId)
  const existing = children.find((item) => item.name === '_Processed' && isFolder(item))
  const processedFolder = existing ?? (await deps.ensureFolder('_Processed', deps.rootId))
  const processed: string[] = []
  const skipped: string[] = []
  for (const folder of children) {
    if (!isFolder(folder) || folder.name === '_Processed') continue
    const files = await deps.listChildren(folder.id)
    for (const file of files) {
      if (!isCardJson(file)) continue
      const text = await deps.readText(file.id)
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        skipped.push(file.name)
        continue
      }
      const card = cardFromUnknown(parsed)
      if (!card) {
        skipped.push(file.name)
        continue
      }
      await deps.write(cardCypher(card))
      await deps.move(file.id, folder.id, processedFolder.id)
      processed.push(file.name)
    }
  }
  return { processed, skipped }
}

function required(env: NodeJS.ProcessEnv) {
  const uri = env.NEO4J_URI
  const user = env.NEO4J_USER
  const password = env.NEO4J_PASSWORD
  const folderId = env.DRIVE_FOLDER_ID
  const account = env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!uri || !user || !password || !folderId || !account) {
    throw new Error('NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, DRIVE_FOLDER_ID, and GOOGLE_SERVICE_ACCOUNT_JSON are required')
  }
  return { uri, user, password, folderId, account }
}

export async function runRelay(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
  const config = required(env)
  const token = await googleAccessToken(config.account, fetchImpl)
  return relayDropzone({
    rootId: config.folderId,
    listChildren: (folderId) => listChildren(token, folderId, fetchImpl),
    readText: (fileId) => readFileText(token, fileId, fetchImpl),
    move: (fileId, fromId, toId) => moveFile(token, fileId, fromId, toId, fetchImpl),
    ensureFolder: (name, parentId) => createFolder(token, name, parentId, fetchImpl),
    write: (statements) => writeCypher(statements, { uri: config.uri, user: config.user, password: config.password }),
  })
}
