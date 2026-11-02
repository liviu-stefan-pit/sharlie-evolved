/** `chats` per docs/HOST_ACTIONS.md: transcript files this tool contributed. */
export type SourceFolder = { tool: string; path: string; chats?: number }

export type CardRelation = {
  entity: string
  relation: string
  target_entity: string
}

export type GraphNode = {
  id: string
  kind: string
  label: string
  color: string
  degree?: number
  synced?: boolean
  title?: string
  created_at?: string
  solution?: string
  failure_modes?: string[]
  relations?: CardRelation[]
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

export type GraphLink = {
  source: string | GraphNode
  target: string | GraphNode
}

export type GraphData = {
  canvas: string
  panel: string
  border: string
  text: string
  muted: string
  accent: string
  synced: string
  pending: string
  nodes: GraphNode[]
  links: GraphLink[]
}

export type ModelParameterValue = { id: string; value: string }

export type CatalogParameter = {
  id: string
  displayName?: string
  values: { value: string; displayName?: string }[]
}

export type CatalogModel = {
  id: string
  displayName: string
  parameters?: CatalogParameter[]
}

export type IngestState = {
  visible: true
  lines: string[]
  tokens: number
  unreported: number
}

export type PageState = {
  title: string
  paused: boolean
  profile: { username: string; email: string; team: string }
  provider: string
  providers: string[]
  savedProviders: string[]
  model: string
  modelParams: ModelParameterValue[]
  models: CatalogModel[]
  hasKey: boolean
  keyExpiresAt: string
  vaultPath: string
  drivePath: string
  autoDrop: boolean
  cadence: '15m' | '30m' | '1h' | 'manual'
  customBaseUrl: string
  sources: SourceFolder[]
  graph: GraphData
  learning: { active: boolean; done: number; total: number; lessons?: number; error?: string; tokens?: number; unreported?: number } | null
  learningTokens: number
  learningTokensUnreported: number
  ingest: IngestState | null
  notice?: string
  /** docs/HOST_ACTIONS.md: stable token for a refused command (notice holds the sentence). */
  errorCode?: string
  /** docs/HOST_ACTIONS.md: every folder the scan looked in, in scan order. */
  searched?: Array<{ tool: string; path: string }>
  /** docs/HOST_ACTIONS.md: sum of sources[].chats. */
  chatsFound?: number
  /** docs/HOST_ACTIONS.md: the one team-Drive switch, false by default. */
  share?: boolean
  /** docs/HOST_ACTIONS.md: set when a pass finishes or is cancelled. */
  learningResult?: { lessons: number; chats: number; text: string } | null
}

export function formatTokenTotal(tokens: number, unreported: number) {
  const count = tokens.toLocaleString('en-US')
  const suffix = unreported > 0 ? ` · ${unreported} call${unreported === 1 ? '' : 's'} unreported` : ''
  return `${count} tokens${suffix}`
}

export function formatLearningCount(done: number, total: number, tokens: number, unreported: number) {
  return `Learning ${done} of ${total} · ${formatTokenTotal(tokens, unreported)}`
}

export type LookupResult = {
  model?: string
  answer?: string
}

export const providers = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
] as const

export const cadences = ['15m', '30m', '1h', 'manual'] as const
