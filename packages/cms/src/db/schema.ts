import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { Translations } from '../translate'

/**
 * Generic schema shared by every site. Content lives as JSON in `documents`,
 * validated by the Zod schemas generated from the site's cms.config.ts.
 */

const now = sql`(unixepoch() * 1000)`

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    /** Collection or singleton name, e.g. "projects". */
    type: text('type').notNull(),
    slug: text('slug').notNull(),
    locale: text('locale').notNull(),
    status: text('status', { enum: ['draft', 'published'] })
      .notNull()
      .default('draft'),
    /** Set when some translated text is a machine draft nobody has checked ("Óyfirfarið"). */
    needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    /**
     * Rows of a translated locale only: per translatable text (keyed by its path), a hash
     * of the source text and its state (machine, reviewed, pending, failed). See translate.ts.
     */
    translations: text('translations', { mode: 'json' }).$type<Translations>(),
    sort: integer('sort').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('documents_type_slug_locale').on(t.type, t.slug, t.locale),
    index('documents_type_status').on(t.type, t.status),
  ],
)

/** Photos. Only the master image is stored (ADR 0001); `/img` makes every width from it. */
export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  /** Object key of the master image in R2. */
  key: text('key').notNull().unique(),
  /** Name of the file the editor picked. */
  filename: text('filename').notNull(),
  /** Of the master: always image/webp. */
  mime: text('mime').notNull(),
  /** Bytes of the master. */
  size: integer('size').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Blurred preview as a data URI, made once at upload. */
  lqip: text('lqip'),
  /** Optional description; editing it in Myndasafn updates it everywhere. */
  alt: text('alt'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
})

/**
 * Which document uses which photo, one row per document locale. Rewritten on every save,
 * so Myndasafn can tell where a photo is used without reading every document.
 */
export const mediaRefs = sqliteTable(
  'media_refs',
  {
    mediaId: text('media_id')
      .notNull()
      .references(() => media.id),
    docType: text('doc_type').notNull(),
    docSlug: text('doc_slug').notNull(),
    locale: text('locale').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.docType, t.docSlug, t.locale] }),
    index('media_refs_doc').on(t.docType, t.docSlug),
  ],
)

export const enquiries = sqliteTable('enquiries', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  service: text('service'),
  message: text('message').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  emailedAt: integer('emailed_at', { mode: 'timestamp_ms' }),
})

/**
 * Small site-wide counters. `content_version` goes up on every admin write; the site's
 * edge cache puts it in the cache key, so any save makes pages re-render on their next visit.
 */
export const siteMeta = sqliteTable('site_meta', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
})

export type DocumentRow = typeof documents.$inferSelect
export type MediaRow = typeof media.$inferSelect
export type EnquiryRow = typeof enquiries.$inferSelect
