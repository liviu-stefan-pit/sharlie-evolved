import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'electron', 'dist', 'main.mjs')

mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'external',
  external: ['electron'],
  logLevel: 'info',
})
