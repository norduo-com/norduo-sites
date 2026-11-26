import { defineConfig, devices } from '@playwright/test'

const port = 4173

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
    command: `pnpm db:migrate:local && pnpm preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
})
