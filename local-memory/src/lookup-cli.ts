import { pathToFileURL } from 'node:url'
import { ask, type Machine, type ModelExchange } from './app.ts'
import { callModel as exchange } from './exchange.ts'

export async function callModel(
  request: Parameters<typeof exchange>[0],
  fetchImpl?: Parameters<typeof exchange>[1],
  deps?: Parameters<typeof exchange>[2],
) {
  return exchange(request, fetchImpl, deps)
}

export function main(argv: string[], exchange: ModelExchange = callModel, machine?: Machine) {
  const directory = argv[0] ?? ''
  const question = argv.slice(1).join(' ')
  return ask(directory, question, exchange, machine)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(await main(process.argv.slice(2)))
}
