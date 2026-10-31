import { Entry, findCredentials } from '@napi-rs/keyring'

const service = 'sharlie-local-memory'

function entry(vaultId: string, keyId: string) {
  return new Entry(service, `${vaultId}/${keyId}`)
}

export function writeSecret(vaultId: string, keyId: string, secret: string) {
  entry(vaultId, keyId).setPassword(secret)
}

export function readSecret(vaultId: string, keyId: string): string {
  const secret = entry(vaultId, keyId).getPassword()
  if (secret == null) throw new Error(`No secret stored for key ${keyId}`)
  return secret
}

export function deleteVault(vaultId: string) {
  for (const credential of findCredentials(service)) {
    if (credential.account.startsWith(`${vaultId}/`)) {
      new Entry(service, credential.account).deletePassword()
    }
  }
}
