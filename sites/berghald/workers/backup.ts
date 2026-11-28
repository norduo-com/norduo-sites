/**
 * Nightly backup: one JSON object per CMS table in R2, under backups/<YYYY-MM-DD>/.
 * D1 Time Travel already gives 30 days of point-in-time restore; this is the longer copy.
 * The `backups-90d` lifecycle rule deletes copies after 90 days (docs/ops.md).
 *
 * `enquiries` is left out: it holds customers' personal data, which is kept only as long as
 * its own retention allows (#45), and Time Travel covers it for 30 days.
 */
export const BACKUP_TABLES = ['documents', 'media', 'media_refs', 'site_meta'] as const

export async function backupToR2(env: Pick<Env, 'DB' | 'MEDIA'>, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10)
  // A table at a time, so only one is in memory and a large one can't hold up the rest.
  for (const table of BACKUP_TABLES) {
    const { results } = await env.DB.prepare(`select * from ${table}`).all()
    await env.MEDIA.put(`backups/${day}/${table}.json`, JSON.stringify(results), {
      httpMetadata: { contentType: 'application/json' },
    })
  }
}
