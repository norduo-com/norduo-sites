import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

// Stop before the run when .dev.vars is missing or lacks a key from .dev.vars.example.
execFileSync('sh', [join(import.meta.dirname, 'scripts/check-dev-vars.sh')], { stdio: 'inherit' })

const port = 4173
const e2eState = '.wrangler/e2e'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Safari can't encode WebP, so photo upload takes the JPEG path there (issue #27), and it
    // only loads a video's frames once it has played, so the poster still needs a play first.
    {
      name: 'webkit',
      testMatch: /photos\.spec|gallery\.spec/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'iphone',
      testMatch: /photos\.spec|gallery\.spec/,
      use: { ...devices['iPhone 15'] },
    },
  ],
  // The build must contain .dev.vars (ENVIRONMENT=development): it turns off the Access
  // check and the page cache. CI copies .dev.vars.example before building.
  webServer: {
    // Each run starts from an empty D1 and R2 of its own, as on CI, so leftovers from a
    // previous run can't pass or fail a test. `pnpm dev` keeps its data in .wrangler/state.
    command: `rm -rf ${e2eState} && wrangler d1 migrations apply berghald --local --persist-to ${e2eState} && pnpm preview --port ${String(port)} --strictPort`,
    env: { E2E_STATE: e2eState },
    port,
    reuseExistingServer: !process.env.CI,
  },
})
