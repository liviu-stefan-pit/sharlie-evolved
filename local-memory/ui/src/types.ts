export type SourceFolder = { tool: string; path: string }

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
  synced?: boolean
  title?: string
  created_at?: string
  solution?: string
  failure_modes?: string[]
  relations?: CardRelation[]
  x?: number
  y?: number
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

export type PageState = {
  title: string
  paused: boolean
  profile: { username: string; email: string; team: string }
  provider: string
  providers: string[]
  model: string
  models: { id: string; displayName: string }[]
  keyMask: string
  hasKey: boolean
  vaultPath: string
  drivePath: string
  autoDrop: boolean
  cadence: '15m' | '30m' | '1h' | 'manual'
  customBaseUrl: string
  sources: SourceFolder[]
  graph: GraphData
  notice?: string
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
  { id: 'custom', label: 'Custom' },
] as const

export const cadences = ['15m', '30m', '1h', 'manual'] as const
