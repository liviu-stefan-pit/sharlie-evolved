import { createRequire } from 'node:module'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const archive = join('release', 'win-unpacked', 'resources', 'app.asar')

if (!existsSync(archive)) {
  console.error('PACK_FAIL no app.asar. The Windows build did not produce win-unpacked.')
  process.exit(1)
}

const found = new Set(asar.listPackage(archive))
const unpacked = join('release', 'win-unpacked', 'resources', 'app.asar.unpacked')

function walk(directory) {
  if (!existsSync(directory)) return
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) walk(path)
    else found.add(path.replaceAll('\\', '/'))
  }
}

walk(unpacked)
const keyring = [...found].filter((path) => path.toLowerCase().includes('keyring') && path.toLowerCase().includes('win32'))
if (keyring.length === 0) {
  console.error('PACK_FAIL the Windows keyring module is missing from the package.')
  const related = [...found].filter((path) => path.toLowerCase().includes('keyring'))
  console.error(related.length > 0 ? related.join('\n') : '(no keyring paths)')
  process.exit(1)
}
console.log(keyring.join('\n'))
