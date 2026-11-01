import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'ui/e2e-window',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
})
