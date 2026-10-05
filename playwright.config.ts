import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:9292', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'bunx vite --config test/browser/fixture/vite.config.ts',
      url: 'http://127.0.0.1:5173/@vite/client',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node test/browser/fixture/storefront.mjs',
      url: 'http://127.0.0.1:9292',
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
