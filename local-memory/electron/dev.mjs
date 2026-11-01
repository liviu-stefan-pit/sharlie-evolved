import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'ui/vite.config.ts'], {
  cwd: root,
  stdio: 'inherit',
})

async function waitForVite() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:1420')
      if (response.status < 500) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Vite did not start')
}

let electron
try {
  await waitForVite()
  electron = spawn(process.execPath, [join(root, 'node_modules', 'electron', 'cli.js'), '.'], {
    cwd: root,
    stdio: 'inherit',
  })
} catch (error) {
  vite.kill()
  throw error
}

function stop() {
  vite.kill()
  electron?.kill()
}

electron.on('exit', () => {
  vite.kill()
  process.exit(0)
})
vite.on('exit', () => {
  electron?.kill()
})
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
