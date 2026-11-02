import type { LookupResult, PageState } from './types'

/** Plain reason shown on the service screen when the preload bridge never arrived. */
export const MISSING_BRIDGE = 'The desktop bridge did not load, so the window cannot reach the background service.'

// Never throws: a missing preload must turn into a readable error screen, not a blank window.
function bridge() {
  return typeof window === 'undefined' ? undefined : window.sharlie
}

function missing<T>(): Promise<T> {
  return Promise.reject(new Error(MISSING_BRIDGE))
}

/** Run a bridge call so a synchronous throw inside it becomes a rejected promise too. */
function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(run())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

export function hasBridge() {
  return !!bridge()
}

export function loadState(): Promise<PageState> {
  const sharlie = bridge()
  return sharlie ? call(() => sharlie.state()) : missing()
}

export function runAction(body: Record<string, unknown>): Promise<PageState> {
  const sharlie = bridge()
  return sharlie ? call(() => sharlie.action(body)) : missing()
}

export function runLookup(query: string): Promise<LookupResult> {
  const sharlie = bridge()
  return sharlie ? call(() => sharlie.lookup(query)) : missing()
}

export function onLearning(callback: (state: PageState) => void) {
  const sharlie = bridge()
  if (!sharlie?.onLearning) return () => {}
  try {
    return sharlie.onLearning(callback)
  } catch {
    return () => {}
  }
}

/** Optional host capability: stopping a learning run. Absent until the host ships it. */
export function canCancelLearning() {
  return typeof bridge()?.cancelLearning === 'function'
}

export function cancelLearning(): Promise<unknown> {
  const sharlie = bridge()
  if (!sharlie?.cancelLearning) return missing()
  const cancel = sharlie.cancelLearning
  return call(() => Promise.resolve(cancel()))
}

/** Check again: the host's rescan when it has one, otherwise a fresh state read. */
export function checkSources(): Promise<PageState> {
  const sharlie = bridge()
  if (!sharlie) return missing()
  const check = sharlie.checkSources
  if (typeof check === 'function') return call(() => Promise.resolve(check()))
  return loadState()
}

export type { LookupResult, PageState }
