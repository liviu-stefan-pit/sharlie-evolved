import type { PageState } from './types'

/** Providers that can actually learn (Lyra): Copilot stays a chat source, Custom is hidden. */
/** Never promises more than the host runs: a schedule only when the host reports it registered. */
export function cadenceLabel(state: Pick<PageState, 'cadence' | 'scheduled'>) {
  if (state.cadence === 'manual') return 'Learns when you ask'
  if (state.scheduled !== true) return 'Learns when you open Sharlie'
  return `Learns ${everyText(state.cadence)}`
}

export function everyText(cadence: PageState['cadence']) {
  return cadence === '15m' ? 'every 15 minutes' : cadence === '30m' ? 'every 30 minutes' : 'every hour'
}

/** Team sharing needs the `share` field and the set-share / pick-folder actions; a host without `share` lacks them. */
export function canShare(state: Pick<PageState, 'share'>) {
  return typeof state.share === 'boolean'
}

export const keyProviders = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'cursor', label: 'Cursor' },
] as const

export const nothingFound = 'Nothing to learn from yet'

export type StepId = 'found' | 'profile' | 'key' | 'sharing' | 'start'

export function profileDone(state: PageState) {
  const p = state.profile
  return p.username.trim() !== '' && p.email.trim() !== '' && p.team.trim() !== ''
}

/** Which required model options still have no value. */
export function missingParams(state: PageState) {
  const chosen = state.models.find((item) => item.id === state.model)
  return (chosen?.parameters ?? []).filter(
    (parameter) =>
      parameter.values.length > 0 &&
      !state.modelParams.some((item) => item.id === parameter.id && parameter.values.some((v) => v.value === item.value)),
  )
}

/**
 * The AI key step: a saved key that is switched on, a model and its options. Returns the
 * plain reason it is not done yet, or '' when it is.
 */
export function keyHold(state: PageState) {
  if (!state.hasKey || state.savedProviders.length === 0) return 'Add an AI key so Sharlie can write lessons.'
  if (state.provider === '') return 'Turn your saved key on.'
  if (state.models.length === 0) return 'This provider has no model list. Choose Anthropic or OpenAI.'
  if (state.model === '') return 'Choose a model.'
  if (missingParams(state).length > 0) return 'Choose the model options.'
  return ''
}

export function profileHold(state: PageState) {
  return profileDone(state) ? '' : 'Add your name, email, and team so each lesson has an author.'
}

/** First unfinished required step, or null when Start can run. Sharing never blocks Start. */
export function firstTodo(state: PageState): 'found' | 'profile' | 'key' | null {
  if (nothingToLearn(state)) return 'found'
  if (profileHold(state)) return 'profile'
  if (keyHold(state)) return 'key'
  return null
}

/** Distinct tool names found on this PC, in the order the host lists them. */
export function foundTools(state: PageState) {
  const seen: string[] = []
  for (const source of state.sources) {
    if (source.chats === 0) continue
    if (!seen.includes(source.tool)) seen.push(source.tool)
  }
  return seen
}

/** Chats found on this PC: the host's chatsFound, else the sum of sources[].chats, else unknown. */
export function chatsFound(state: PageState): number | undefined {
  if (typeof state.chatsFound === 'number') return state.chatsFound
  const counts = state.sources.map((source) => source.chats).filter((n): n is number => typeof n === 'number')
  return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : undefined
}

export function nothingToLearn(state: PageState) {
  return foundTools(state).length === 0 || chatsFound(state) === 0
}

/** "Cursor, Claude CLI · 412 chats" */
export function foundSummary(state: PageState) {
  const count = chatsFound(state)
  const tools = foundTools(state).join(', ')
  return count === undefined ? tools : `${tools} · ${count.toLocaleString('en-US')} ${count === 1 ? 'chat' : 'chats'}`
}
