/// <reference types="vite/client" />

import type { LookupResult, PageState } from './types'

interface SharlieBridge {
  state: () => Promise<PageState>
  action: (body: Record<string, unknown>) => Promise<PageState>
  lookup: (query: string) => Promise<LookupResult>
  onLearning: (callback: (state: PageState) => void) => () => void
  /** Optional: stop the running learning pass (host may not provide it yet). */
  cancelLearning?: () => Promise<unknown> | unknown
}

declare global {
  interface Window {
    sharlie?: SharlieBridge
  }
}

export {}
