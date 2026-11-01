import { spawn } from 'node:child_process'

const main = new URL('./main.ts', import.meta.url)

if (process.env.SHARLIE_STRIP_TYPES === '1') {
  await import(main.href)
} else {
  try {
    await import(main.href)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw error
    const child = spawn(process.execPath, ['--experimental-strip-types', ...process.argv.slice(1)], {
      stdio: 'inherit',
      env: { ...process.env, SHARLIE_STRIP_TYPES: '1' },
    })
    child.on('exit', (status) => {
      process.exit(status ?? 0)
    })
  }
}
