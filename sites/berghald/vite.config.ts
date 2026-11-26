import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // No remote bindings: AI would need a Cloudflare login, which CI's e2e job doesn't have.
    // Locally, translation uses the fake translator (TRANSLATOR=fake in .dev.vars).
    cloudflare({ viteEnvironment: { name: 'ssr' }, remoteBindings: false }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: { tsconfigPaths: true },
  // For Sentry. scripts/sourcemaps.sh uploads the maps and deletes them before deploy.
  build: { sourcemap: true },
})
