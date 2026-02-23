import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:3201',
  },
  webServer: {
    command: process.env.CI ? 'pnpm preview' : 'pnpm dev',
    port: 3201,
    reuseExistingServer: !process.env.CI,
  },
})
