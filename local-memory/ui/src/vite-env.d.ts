/// <reference types="vite/client" />

import type { LookupResult, PageState } from './types'

interface SharlieBridge {
  state: () => Promise<PageState>
  action: (body: Record<string, unknown>) => Promise<PageState>
  lookup: (query: string) => Promise<LookupResult>
  onLearning: (callback: (state: PageState) => void) => () => void
  /** docs/HOST_ACTIONS.md: stop the running pass; resolves with the snapshot. Checked before use. */
  cancelLearning?: () => Promise<PageState>
}

declare global {
  interface Window {
    sharlie?: SharlieBridge
  }
}

export {}
