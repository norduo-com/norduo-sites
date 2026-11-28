import { desc, eq, sql } from 'drizzle-orm'

import { documents, media, mediaRefs } from '../db/schema'
import type { CmsConfig } from '../define'
import type { Fields } from '../fields'
import { type MediaUse, mediaUsesOf, removeFromGalleries } from '../media'
import { bumpContentVersion } from './translate'
import { type Db, fieldsOfDocument } from './types'

/* Myndasafn: every photo and video, where each is used, alt text and deleting. */

/** A document that uses a photo; `title` is a collection item's title field, if it has one. */
export interface MediaUseRef {
  type: string
  slug: string
  title: string | null
}

/** The documents that use a photo, split by whether they block deleting it. */
export interface MediaUses {
  /** In an `image()` field: the photo can't be deleted until it's replaced there. */
  image: MediaUseRef[]
  /** Only in galleries: deleting the photo removes it from them. */
  gallery: MediaUseRef[]
}

/** A photo in Myndasafn. `uses` comes from `media_refs`, one per document. */
export interface AdminMedia {
  id: string
  filename: string
  /** image/webp for a photo's master, video/mp4 for a video. */
  mime: string
  width: number | null
  height: number | null
  lqip: string | null
  alt: string | null
  createdAt: number
  uses: { type: string; slug: string }[]
}

/** Every photo and video, newest first, with the documents that use each. */
export async function listMedia(db: Db): Promise<AdminMedia[]> {
  const [rows, refs] = await Promise.all([
    db
      .select({
        id: media.id,
        filename: media.filename,
        mime: media.mime,
        width: media.width,
        height: media.height,
        lqip: media.lqip,
        alt: media.alt,
        createdAt: media.createdAt,
      })
      .from(media)
      .orderBy(desc(media.createdAt)),
    db
      .selectDistinct({
        mediaId: mediaRefs.mediaId,
        type: mediaRefs.docType,
        slug: mediaRefs.docSlug,
      })
      .from(mediaRefs),
  ])
  const usesOf = new Map<string, AdminMedia['uses']>()
  for (const { mediaId, type, slug } of refs)
    usesOf.set(mediaId, [...(usesOf.get(mediaId) ?? []), { type, slug }])
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), uses: usesOf.get(r.id) ?? [] }))
}

/**
 * Sets a photo's alt text. Alt lives on the photo, so it changes everywhere the photo is
 * shown. Returns false if there is no such photo.
 */
export async function setAlt(db: Db, id: string, alt: string): Promise<boolean> {
  const [updated] = await db.batch([
    db
      .update(media)
      .set({ alt: alt || null })
      .where(eq(media.id, id))
      .returning({ id: media.id }),
    bumpContentVersion(db),
  ])
  return updated.length > 0
}

/**
 * The documents that use a photo, read through `media_refs`, each with how it uses the
 * photo. A document counts as an `image` use if any of its locales has it in an `image()`.
 */
async function documentsUsing(db: Db, config: CmsConfig, id: string) {
  const refs = await db
    .selectDistinct({ type: mediaRefs.docType, slug: mediaRefs.docSlug })
    .from(mediaRefs)
    .where(eq(mediaRefs.mediaId, id))
  const rows = refs.length
    ? await db
        .select({
          id: documents.id,
          type: documents.type,
          slug: documents.slug,
          locale: documents.locale,
          data: documents.data,
        })
        .from(documents)
        // A subquery, not one condition per document: D1 allows 100 bound parameters.
        .where(
          sql`exists (select 1 from ${mediaRefs} where ${mediaRefs.mediaId} = ${id}
            and ${mediaRefs.docType} = ${documents.type} and ${mediaRefs.docSlug} = ${documents.slug})`,
        )
    : []
  const out: (MediaUseRef & { use: MediaUse; rows: typeof rows; fields: Fields })[] = []
  for (const ref of refs) {
    const fields = fieldsOfDocument(config, ref.type, ref.slug)
    if (!fields) continue
    const own = rows.filter((r) => r.type === ref.type && r.slug === ref.slug)
    const uses = own.map((r) => mediaUsesOf(fields, r.data).get(id))
    if (!uses.some(Boolean)) continue
    const titleField = Object.hasOwn(config.collections, ref.type)
      ? config.collections[ref.type]?.titleField
      : undefined
    const title = titleField
      ? (own.find((r) => r.locale === config.site.defaultLocale) ?? own[0])?.data[titleField]
      : undefined
    out.push({
      type: ref.type,
      slug: ref.slug,
      title: typeof title === 'string' && title ? title : null,
      use: uses.includes('image') ? 'image' : 'gallery',
      rows: own,
      fields,
    })
  }
  return out
}

const usesBody = (docs: Awaited<ReturnType<typeof documentsUsing>>): MediaUses => ({
  image: docs
    .filter((d) => d.use === 'image')
    .map(({ type, slug, title }) => ({ type, slug, title })),
  gallery: docs
    .filter((d) => d.use === 'gallery')
    .map(({ type, slug, title }) => ({ type, slug, title })),
})

/** Where a photo is used, or null if there is no such photo. */
export async function mediaUses(db: Db, config: CmsConfig, id: string): Promise<MediaUses | null> {
  const exists = await db.select({ id: media.id }).from(media).where(eq(media.id, id)).get()
  return exists ? usesBody(await documentsUsing(db, config, id)) : null
}

export type DeleteMediaResult =
  { ok: true } | { error: 'notFound' } | { error: 'inUse' | 'inGalleries'; uses: MediaUses }

/**
 * Deletes a photo. Refused while an `image()` field uses it (it must be replaced there
 * first). Galleries that have it lose it, but only with `removeFromGalleries`, which
 * Vefstjórn sends after the editor confirms.
 */
export async function deleteMedia(
  db: Db,
  bucket: R2Bucket,
  config: CmsConfig,
  id: string,
  options: { removeFromGalleries: boolean },
): Promise<DeleteMediaResult> {
  const row = await db.select({ key: media.key }).from(media).where(eq(media.id, id)).get()
  if (!row) return { error: 'notFound' }
  const docs = await documentsUsing(db, config, id)
  const uses = usesBody(docs)
  if (uses.image.length) return { error: 'inUse', uses }
  if (uses.gallery.length && !options.removeFromGalleries) return { error: 'inGalleries', uses }

  const now = new Date()
  await db.batch([
    db.delete(mediaRefs).where(eq(mediaRefs.mediaId, id)),
    ...docs.flatMap((d) =>
      d.rows.map((r) =>
        db
          .update(documents)
          .set({ data: removeFromGalleries(d.fields, r.data, id), updatedAt: now })
          .where(eq(documents.id, r.id)),
      ),
    ),
    db.delete(media).where(eq(media.id, id)),
    bumpContentVersion(db),
  ])
  await bucket.delete(row.key)
  return { ok: true }
}
