export type DriveItem = {
  id: string
  name: string
  mimeType: string
}

const FOLDER = 'application/vnd.google-apps.folder'

type TokenAccount = {
  client_email?: string
  private_key?: string
  token_uri?: string
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

export async function googleAccessToken(serviceAccountJson: string, fetchImpl: typeof fetch = fetch) {
  let account: TokenAccount
  try {
    account = JSON.parse(serviceAccountJson) as TokenAccount
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not JSON')
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  const key = account.private_key.includes('\n') ? account.private_key : account.private_key.replace(/\\n/g, '\n')
  const now = Math.floor(Date.now() / 1000)
  const audience = account.token_uri || 'https://oauth2.googleapis.com/token'
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: audience,
      iat: now,
      exp: now + 3600,
    }),
  )
  const { createSign } = await import('node:crypto')
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  signer.end()
  const assertion = `${header}.${claim}.${signer.sign(key).toString('base64url')}`
  const response = await fetchImpl(audience, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!response.ok) throw new Error(`Google token request failed (${response.status})`)
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error('Google token response had no access_token')
  return body.access_token
}

function driveUrl(path: string, query: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url
}

async function driveJson(response: Response, action: string) {
  if (!response.ok) throw new Error(`Drive ${action} failed (${response.status})`)
  return response.json() as Promise<unknown>
}

export async function listChildren(token: string, folderId: string, fetchImpl: typeof fetch = fetch) {
  const items: DriveItem[] = []
  let pageToken = ''
  do {
    const response = await fetchImpl(
      driveUrl('files', {
        q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType)',
        pageSize: '100',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      }),
      { headers: { authorization: `Bearer ${token}` } },
    )
    const body = (await driveJson(response, 'list')) as { nextPageToken?: string; files?: DriveItem[] }
    items.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return items
}

export async function readFileText(token: string, fileId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(
    driveUrl(`files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: 'true' }),
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!response.ok) throw new Error(`Drive read failed (${response.status})`)
  return response.text()
}

export async function createFolder(token: string, name: string, parentId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(driveUrl('files', { supportsAllDrives: 'true' }), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  })
  const body = (await driveJson(response, 'create folder')) as DriveItem
  return body
}

export async function moveFile(
  token: string,
  fileId: string,
  fromId: string,
  toId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(
    driveUrl(`files/${encodeURIComponent(fileId)}`, {
      addParents: toId,
      removeParents: fromId,
      supportsAllDrives: 'true',
      fields: 'id,parents',
    }),
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
    },
  )
  await driveJson(response, 'move')
}

export function isFolder(item: DriveItem) {
  return item.mimeType === FOLDER
}
