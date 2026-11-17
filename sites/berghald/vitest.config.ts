import { defineConfig } from 'vitest/config'

// Unit/component tests run in jsdom without the Cloudflare/React Router plugins.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['app/**/*.test.{ts,tsx}'],
  },
})
