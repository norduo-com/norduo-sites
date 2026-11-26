import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      // e2e runs keep their own local D1 and R2 (see playwright.config.ts).
      persistState: process.env.E2E_STATE ? { path: process.env.E2E_STATE } : true,
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: { tsconfigPaths: true },
  // For Sentry. scripts/sourcemaps.sh uploads the maps and deletes them before deploy.
  build: { sourcemap: true },
})
