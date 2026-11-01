import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'ui/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 680, height: 520 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config ui/vite.config.ts --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000,
    env: { VITE_E2E: '1' },
  },
})
