import { defineConfig } from 'drizzle-kit'

// Migrations are shared by every site: each site's wrangler.jsonc points
// `migrations_dir` at packages/cms/migrations.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
})
