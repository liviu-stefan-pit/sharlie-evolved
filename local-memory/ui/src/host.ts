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

export function revealKey() {
  return bridge().revealKey()
}

export type { LookupResult, PageState }
