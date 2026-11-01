import { pathToFileURL } from 'node:url'
import { runRelay } from './relay.ts'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRelay().then(
    (result) => {
      console.log(`processed ${result.processed.length}`)
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'relay failed')
      process.exitCode = 1
    },
  )
}
