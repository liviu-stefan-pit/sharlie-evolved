import { Entry, findCredentials } from '@napi-rs/keyring'

const service = 'sharlie-local-memory'
const memory = new Map<string, Map<string, string>>()

function entry(vaultId: string, keyId: string) {
  return new Entry(service, `${vaultId}/${keyId}`)
}

/** npm test stays off the OS keyring: Windows credential calls race, and the Linux kernel keyring quota is tiny. */
function useMemory() {
  if (process.env.SHARLIE_VAULT === 'os') return false
  if (process.env.SHARLIE_VAULT === 'memory') return true
  return process.env.NODE_TEST_CONTEXT != null
}

function memoryKeys(vaultId: string) {
  let keys = memory.get(vaultId)
  if (!keys) {
    keys = new Map()
    memory.set(vaultId, keys)
  }
  return keys
}

export function writeSecret(vaultId: string, keyId: string, secret: string) {
  if (useMemory()) {
    memoryKeys(vaultId).set(keyId, secret)
    return
  }
  entry(vaultId, keyId).setPassword(secret)
}

export function readSecret(vaultId: string, keyId: string): string {
  if (useMemory()) {
    const secret = memory.get(vaultId)?.get(keyId)
    if (secret == null) throw new Error(`No secret stored for key ${keyId}`)
    return secret
  }
  const secret = entry(vaultId, keyId).getPassword()
  if (secret == null) throw new Error(`No secret stored for key ${keyId}`)
  return secret
}

export function deleteSecret(vaultId: string, keyId: string) {
  if (useMemory()) {
    const keys = memory.get(vaultId)
    if (!keys?.delete(keyId)) throw new Error(`No secret stored for key ${keyId}`)
    return
  }
  entry(vaultId, keyId).deletePassword()
}

export function deleteVault(vaultId: string) {
  if (useMemory()) {
    memory.delete(vaultId)
    return
  }
  for (const credential of findCredentials(service)) {
    if (credential.account.startsWith(`${vaultId}/`)) {
      new Entry(service, credential.account).deletePassword()
    }
  }
}

export function listSecrets(): { account: string; password: string }[] {
  if (useMemory()) {
    const stored: { account: string; password: string }[] = []
    for (const [vaultId, keys] of memory) {
      for (const [keyId, password] of keys) stored.push({ account: `${vaultId}/${keyId}`, password })
    }
    return stored
  }
  return findCredentials(service).map((credential) => ({
    account: credential.account,
    password: credential.password,
  }))
}
