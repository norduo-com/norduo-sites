import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // The image and video tests run Sharp and Miniflare; on CI runners some take about 5 s,
    // Vitest's default, which failed the main runs after #59 and #68.
    testTimeout: 20_000,
  },
})
