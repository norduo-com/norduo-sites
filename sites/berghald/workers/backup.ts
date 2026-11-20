/**
 * Nightly backup: dumps the CMS tables as JSON into R2 under backups/.
 * D1 Time Travel already gives 30 days of point-in-time restore; this is the
 * long-term copy.
 */
const TABLES = ['documents', 'media', 'enquiries', 'site_meta'] as const

export async function backupToR2(env: Env): Promise<void> {
  const dump: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    const { results } = await env.DB.prepare(`select * from ${table}`).all()
    dump[table] = results
  }
  const day = new Date().toISOString().slice(0, 10)
  await env.MEDIA.put(`backups/${day}.json`, JSON.stringify(dump), {
    httpMetadata: { contentType: 'application/json' },
  })
}
