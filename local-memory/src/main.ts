import { serveDesktopHost } from './host.ts'

const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : null
if (!platform) throw new Error('The app launches on Windows and macOS')

await serveDesktopHost()
