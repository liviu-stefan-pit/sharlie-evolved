import { pathToFileURL } from 'node:url'
import { ask, type Machine, type ModelExchange, type ModelRequest } from './app.ts'

type Post = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

export async function callModel(request: ModelRequest, fetchImpl: Post = fetch as unknown as Post) {
  if (request.provider === 'openai') {
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.secret}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    })
    const body = (await response.json()) as { choices: { message: { content: string } }[] }
    return body.choices[0].message.content
  }
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': request.secret,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: request.prompt }],
    }),
  })
  const body = (await response.json()) as { content: { text: string }[] }
  return body.content[0].text
}

export function main(argv: string[], exchange: ModelExchange = callModel, machine?: Machine) {
  const directory = argv[0] ?? ''
  const question = argv.slice(1).join(' ')
  return ask(directory, question, exchange, machine)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(await main(process.argv.slice(2)))
}
