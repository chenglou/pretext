import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const e2ePort = process.env.PLAYWRIGHT_TEST_PORT ?? '3101'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    trace: 'on-first-retry',
    headless: !process.env.PLAYWRIGHT_HEADED,
  },
  webServer: {
    command: `NEXT_DIST_DIR=.next-e2e ./node_modules/.bin/next start -p ${e2ePort}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: !process.env.CI,
    cwd: path.resolve('.'),
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
