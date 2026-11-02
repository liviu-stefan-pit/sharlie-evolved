import type { PageState } from './types'

/** Providers that can actually learn (Lyra): Copilot stays a chat source, Custom is hidden. */
/** Never promises more than the host runs: a schedule only when the host reports it registered. */
/**
 * The current host refuses a start with only a sentence (no errorCode yet). Map its known
 * sentences to the documented codes so the refusal shows at the step it is about.
 */
export function refusalCode(errorCode: string | undefined, notice: string) {
  if (errorCode) return errorCode
  if (/save your username, email, and team/i.test(notice)) return 'profile_incomplete'
  if (/turn on a provider/i.test(notice)) return 'key_missing'
  if (/choose a model|no model list|choose effort/i.test(notice)) return 'model_missing'
  if (/no chats|nothing to learn/i.test(notice)) return 'no_chats'
  return ''
}

/**
 * A learning error the person can act on. A key secret missing from Windows Credential Manager
 * (host text "No secret stored for key …", or a code naming it) means: add the key again.
 */
export const DID_NOT_RUN = "Learning didn't run, and Sharlie gave no reason. Check your AI key in Settings, then press Learn now again."

export function learnProblem(text: string, code = ''): { text: string; settings: boolean } {
  if (text === DID_NOT_RUN) return { text, settings: true }
  if (/secret_missing|missing_secret|key_secret/i.test(code) || /no secret stored|secret (is )?missing|key secret/i.test(text)) {
    return { text: 'Add your AI key again in Settings.', settings: true }
  }
  if (code === 'key_missing' || code === 'model_missing') return { text, settings: true }
  return { text, settings: false }
}

export function cadenceLabel(state: Pick<PageState, 'cadence' | 'scheduled'>) {
  if (state.cadence === 'manual') return 'Learns when you ask'
  if (state.scheduled !== true) return 'Learns when you open Sharlie'
  return `Learns ${everyText(state.cadence)}`
}

// One hour is the shortest schedule (host 7d3ad3a). A 15m or 30m from an older host is shown as every hour.
export function everyText(_cadence: PageState['cadence']) {
  return 'every hour'
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
