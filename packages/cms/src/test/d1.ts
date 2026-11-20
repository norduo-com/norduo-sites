import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

const MIGRATIONS = join(import.meta.dirname, '../../migrations')

/** A real local D1 (via Miniflare) with the shared migrations applied. Tests only. */
export async function testDatabase() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {}',
      compatibilityDate: '2026-11-01',
      d1Databases: ['DB'],
    }),
  )
  // Miniflare's proxy behaves like the Workers binding but isn't constructed by it.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const d1: D1Database = await mf.getD1Database('DB')

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
  const statements: string[] = []
  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS, file), 'utf8')
    statements.push(
      ...sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  }
  for (const statement of statements) await d1.prepare(statement).run()

  const tables = (
    await d1
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
      )
      .all<{ name: string }>()
  ).results.map((r) => r.name)

  return {
    d1,
    /** Empties every table. */
    async reset() {
      for (const t of tables) await d1.prepare(`delete from "${t}"`).run()
    },
    dispose: () => mf.dispose(),
  }
}
