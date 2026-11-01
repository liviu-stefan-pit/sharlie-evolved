import { catalogParameters, catalogVariants, type ModelParameterValue } from './catalog.ts'
import type { ListedModel, ModelRequest } from './app.ts'

type Post = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>

export type ModelReply = {
  text: string
  tokens: number | null
}

export type ExchangeDeps = {
  cursorPrompt?: (request: ModelRequest) => Promise<string | ModelReply>
}

const copilotIntegration = 'copilot-developer-cli'
const cardTokens = 8192

function anthropicText(content: { type?: string; text?: string }[] | undefined) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

function openaiText(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text
      }
      return ''
    })
    .join('')
}

function responsesText(body: {
  output_text?: unknown
  output?: unknown
}) {
  if (typeof body.output_text === 'string' && body.output_text !== '') return body.output_text
  if (typeof body.output === 'string') return body.output
  if (!Array.isArray(body.output)) return ''
  const parts: string[] = []
  for (const item of body.output) {
    if (!item || typeof item !== 'object') continue
    const record = item as { content?: unknown }
    if (typeof record.content === 'string') parts.push(record.content)
    if (Array.isArray(record.content)) parts.push(openaiText(record.content))
  }
  return parts.join('')
}

function chatCompletionsAvailable(item: Record<string, unknown>) {
  const supports =
    item.capabilities && typeof item.capabilities === 'object'
      ? (item.capabilities as { supports?: Record<string, unknown> }).supports
      : undefined
  if (supports && supports.chat_completions === false) return false
  if (supports && supports.responses_only === true) return false
  const endpoints = item.supported_endpoints ?? item.endpoints
  if (!Array.isArray(endpoints) || endpoints.length === 0) return true
  const names = endpoints
    .map((endpoint) => {
      if (typeof endpoint === 'string') return endpoint
      if (endpoint && typeof endpoint === 'object') {
        const record = endpoint as { type?: unknown; path?: unknown; name?: unknown }
        return `${record.type ?? ''} ${record.path ?? ''} ${record.name ?? ''}`
      }
      return ''
    })
    .join(' ')
    .toLowerCase()
  if (names.includes('chat')) return true
  if (names.includes('response')) return false
  return true
}

export async function listCursorCatalog(secret: string): Promise<ListedModel[]> {
  const sdk = (await import('@cursor/sdk')) as {
    Cursor?: { models?: { list?: (options: { apiKey: string }) => Promise<unknown[]> } }
  }
  const listed = await sdk.Cursor?.models?.list?.({ apiKey: secret })
  if (!Array.isArray(listed)) return []
  return listed.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as {
      id?: unknown
      displayName?: unknown
      parameters?: unknown
      variants?: unknown
    }
    if (typeof record.id !== 'string' || record.id === '') return []
    const displayName = typeof record.displayName === 'string' && record.displayName !== '' ? record.displayName : record.id
    const parameters = catalogParameters(record.parameters)
    const variants = catalogVariants(record.variants)
    return [
      {
        id: record.id,
        displayName,
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(variants.length > 0 ? { variants } : {}),
      },
    ]
  })
}

export async function listCopilotModels(secret: string, fetchImpl: Post = fetch as unknown as Post): Promise<ListedModel[]> {
  const response = await fetchImpl('https://api.githubcopilot.com/models', {
    headers: {
      authorization: `Bearer ${secret}`,
      'Copilot-Integration-Id': copilotIntegration,
      accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`Copilot models ${response.status}`)
  const body = (await response.json()) as { data?: unknown; models?: unknown; items?: unknown }
  const items = [body.data, body.models, body.items].find(Array.isArray) ?? []
  return (items as unknown[]).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { id?: unknown; name?: unknown; displayName?: unknown }
    if (typeof record.id !== 'string' || record.id === '') return []
    const displayName =
      typeof record.displayName === 'string' && record.displayName !== ''
        ? record.displayName
        : typeof record.name === 'string' && record.name !== ''
          ? record.name
          : record.id
    const chatCompletions = chatCompletionsAvailable(item as Record<string, unknown>)
    return [{ id: record.id, displayName, ...(chatCompletions ? {} : { chatCompletions: false }) }]
  })
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function chatUsageTokens(usage: unknown) {
  if (!usage || typeof usage !== 'object') return null
  return asFiniteNumber((usage as { total_tokens?: unknown }).total_tokens)
}

function usageTokens(usage: unknown) {
  if (!usage || typeof usage !== 'object') return null
  const record = usage as Record<string, unknown>
  const total = asFiniteNumber(record.total_tokens) ?? asFiniteNumber(record.totalTokens)
  if (total != null) return total
  const input = asFiniteNumber(record.input_tokens) ?? asFiniteNumber(record.inputTokens)
  const output = asFiniteNumber(record.output_tokens) ?? asFiniteNumber(record.outputTokens)
  if (input == null && output == null) return null
  const cacheRead =
    asFiniteNumber(record.cache_read_input_tokens) ??
    asFiniteNumber(record.cacheReadTokens) ??
    asFiniteNumber(record.cache_read_tokens)
  const cacheWrite =
    asFiniteNumber(record.cache_creation_input_tokens) ??
    asFiniteNumber(record.cacheWriteTokens) ??
    asFiniteNumber(record.cache_write_tokens)
  return (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
}

function asModelReply(result: string | ModelReply): ModelReply {
  if (typeof result === 'string') return { text: result, tokens: null }
  return { text: result.text, tokens: typeof result.tokens === 'number' || result.tokens === null ? result.tokens : null }
}

function cursorPromptText(prompt: string) {
  if (prompt.includes('Do not edit any files.')) return prompt
  return `Do not edit any files.\n${prompt}`
}

async function cursorPrompt(request: ModelRequest, deps: ExchangeDeps): Promise<ModelReply> {
  const prompt = cursorPromptText(request.prompt)
  const asked = { ...request, prompt }
  if (deps.cursorPrompt) return asModelReply(await deps.cursorPrompt(asked))
  const sdk = (await import('@cursor/sdk')) as {
    Agent?: {
      prompt?: (
        text: string,
        options: { apiKey: string; model: { id: string; params?: ModelParameterValue[] }; local: { cwd: string } },
      ) => Promise<unknown>
    }
  }
  if (!sdk.Agent?.prompt) throw new Error('Cursor SDK has no Agent.prompt')
  const params = request.params ?? []
  const result = await sdk.Agent.prompt(prompt, {
    apiKey: request.secret,
    model: { id: request.model, ...(params.length > 0 ? { params } : {}) },
    local: { cwd: request.cwd || process.cwd() },
  })
  if (typeof result === 'string') return { text: result, tokens: null }
  if (result && typeof result === 'object') {
    const record = result as { status?: unknown; result?: unknown; text?: unknown; usage?: unknown }
    if (record.status === 'error') throw new Error('Cursor agent failed')
    const text = typeof record.result === 'string' ? record.result : typeof record.text === 'string' ? record.text : ''
    return { text, tokens: usageTokens(record.usage) }
  }
  return { text: '', tokens: null }
}

async function modelJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(`${label} ${response.status}`)
  return response.json() as Promise<T>
}

function copilotHeaders(secret: string) {
  return {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
    accept: 'application/json',
    'Copilot-Integration-Id': copilotIntegration,
  }
}

export async function callModel(
  request: ModelRequest,
  fetchImpl: Post = fetch as unknown as Post,
  deps: ExchangeDeps = {},
): Promise<ModelReply> {
  if (request.provider === 'cursor') return cursorPrompt(request, deps)
  if (request.provider === 'copilot') {
    const chat = request.chatCompletions !== false
    const response = await fetchImpl(
      chat ? 'https://api.githubcopilot.com/chat/completions' : 'https://api.githubcopilot.com/responses',
      {
        method: 'POST',
        headers: copilotHeaders(request.secret),
        body: JSON.stringify(
          chat
            ? {
                model: request.model,
                max_tokens: cardTokens,
                messages: [{ role: 'user', content: request.prompt }],
              }
            : { model: request.model, input: request.prompt, max_output_tokens: cardTokens },
        ),
      },
    )
    const body = await modelJson<{
      choices?: { message?: { content?: unknown } }[]
      output_text?: unknown
      output?: unknown
      usage?: unknown
    }>(response, 'Copilot')
    if (!chat) return { text: responsesText(body), tokens: usageTokens(body.usage) }
    return { text: openaiText(body.choices?.[0]?.message?.content), tokens: chatUsageTokens(body.usage) }
  }
  if (request.provider === 'custom') {
    const base = (request.baseUrl ?? '').replace(/\/$/, '')
    if (base === '') throw new Error('Custom provider needs a base URL')
    const response = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.secret}`,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: cardTokens,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    })
    const body = await modelJson<{ choices?: { message?: { content?: unknown } }[]; usage?: unknown }>(
      response,
      'Custom',
    )
    return { text: openaiText(body.choices?.[0]?.message?.content), tokens: chatUsageTokens(body.usage) }
  }
  if (request.provider === 'openai') {
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.secret}`,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: cardTokens,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    })
    const body = await modelJson<{ choices?: { message?: { content?: unknown } }[]; usage?: unknown }>(
      response,
      'OpenAI',
    )
    return { text: openaiText(body.choices?.[0]?.message?.content), tokens: chatUsageTokens(body.usage) }
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
      max_tokens: cardTokens,
      messages: [{ role: 'user', content: request.prompt }],
    }),
  })
  const body = await modelJson<{ content?: { type?: string; text?: string }[]; usage?: unknown }>(
    response,
    'Anthropic',
  )
  return { text: anthropicText(body.content), tokens: usageTokens(body.usage) }
}
