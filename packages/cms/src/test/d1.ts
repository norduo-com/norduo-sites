import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

const MIGRATIONS = join(import.meta.dirname, '../../migrations')

/**
 * Miniflare's Node proxy can't pass a transformer into `draw()`. Local (Sharp) mode ignores
 * drawn images anyway, so dropping them here gives the same result.
 */
function localImages(binding: ImagesBinding): ImagesBinding {
  const wrap = (t: ImageTransformer): ImageTransformer => ({
    transform: (x) => wrap(t.transform(x)),
    draw: () => wrap(t),
    output: (o) => t.output(o),
  })
  return {
    info: (stream, options) => binding.info(stream, options),
    input: (stream, options) => wrap(binding.input(stream, options)),
    text: (content, options) => wrap(binding.text(content, options)),
    get hosted() {
      return binding.hosted
    },
  }
}

/**
 * A real local D1 (via Miniflare) with the shared migrations applied, plus a local R2 bucket
 * and the local Images binding (Sharp-based: no blur, draw or quality). Tests only.
 */
export async function testDatabase() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {}',
      compatibilityDate: '2026-11-01',
      d1Databases: ['DB'],
      r2Buckets: ['MEDIA'],
      images: { binding: 'IMAGES' },
    }),
  )
  // Miniflare's proxy behaves like the Workers binding but isn't constructed by it.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment
  const d1: D1Database = await mf.getD1Database('DB')
  const r2 = (await mf.getR2Bucket('MEDIA')) as unknown as R2Bucket
  const images = localImages((await mf.getImagesBinding('IMAGES')) as unknown as ImagesBinding)

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
    r2,
    images,
    /** Empties every table and the bucket. */
    async reset() {
      // Children first, so foreign keys don't block the delete.
      const children = tables.filter((t) => t.endsWith('_refs'))
      for (const t of [...children, ...tables.filter((t) => !children.includes(t))])
        await d1.prepare(`delete from "${t}"`).run()
      const { objects } = await r2.list()
      if (objects.length) await r2.delete(objects.map((o) => o.key))
    },
    dispose: () => mf.dispose(),
  }
}
