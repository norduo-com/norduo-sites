import { describe, expect, it } from 'vitest'

import { backupToR2 } from './backup'

describe('backupToR2', () => {
  it('writes one object per table and leaves enquiries out', async () => {
    const queried: string[] = []
    const put = new Map<string, string>()
    const env = {
      DB: {
        prepare: (sql: string) => {
          queried.push(sql)
          return { all: () => Promise.resolve({ results: [{ sql }] }) }
        },
      },
      MEDIA: { put: (key: string, body: string) => Promise.resolve(void put.set(key, body)) },
    } as unknown as Pick<Env, 'DB' | 'MEDIA'>

    await backupToR2(env, new Date('2026-11-28T03:00:00Z'))

    expect([...put.keys()]).toEqual([
      'backups/2026-11-28/documents.json',
      'backups/2026-11-28/media.json',
      'backups/2026-11-28/media_refs.json',
      'backups/2026-11-28/site_meta.json',
    ])
    expect(queried.some((q) => q.includes('enquiries'))).toBe(false)
    expect(JSON.parse(put.get('backups/2026-11-28/media.json') ?? '')).toEqual([
      { sql: 'select * from media' },
    ])
  })
})
