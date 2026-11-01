import type { LookupResult, PageState } from './types'

function bridge() {
  const sharlie = window.sharlie
  if (!sharlie) throw new Error('Sharlie host is not available')
  return sharlie
}

export function loadState() {
  return bridge().state()
}

export function runAction(body: Record<string, unknown>) {
  return bridge().action(body)
}

export function runLookup(query: string) {
  return bridge().lookup(query)
}

export function onLearning(callback: (state: PageState) => void) {
  const sharlie = window.sharlie
  if (!sharlie?.onLearning) return () => {}
  return sharlie.onLearning(callback)
}

export type { LookupResult, PageState }
