/// <reference types="vite/client" />

import type { LookupResult, PageState } from './types'

interface SharlieBridge {
  state: () => Promise<PageState>
  action: (body: Record<string, unknown>) => Promise<PageState>
  lookup: (query: string) => Promise<LookupResult>
  revealKey: () => Promise<{ secret: string }>
}

declare global {
  interface Window {
    sharlie?: SharlieBridge
  }
}

export {}
