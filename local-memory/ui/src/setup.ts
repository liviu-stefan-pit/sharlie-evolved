import type { PageState } from './types'

/** Providers that can actually learn (Lyra): Copilot stays a chat source, Custom is hidden. */
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
  if (foundTools(state).length === 0) return 'found'
  if (profileHold(state)) return 'profile'
  if (keyHold(state)) return 'key'
  return null
}

/** Distinct tool names found on this PC, in the order the host lists them. */
export function foundTools(state: PageState) {
  const seen: string[] = []
  for (const source of state.sources) if (!seen.includes(source.tool)) seen.push(source.tool)
  return seen
}
