import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { documents, media, mediaRefs } from '../db/schema'
import type { CmsConfig } from '../define'
import { type Fields, schemaOf } from '../fields'
import { mediaIdsOf } from '../media'
import { slugify, uniqueSlug } from '../slug'
import {
  editLocale,
  type LocaleRow,
  needsReview,
  planLocale,
  type Translations,
} from '../translate'
import { bumpContentVersion } from './translate'
import { type Db, fieldsOfDocument, isIdentifier, PAGES_TYPE } from './types'

/*
 * Vefstjórn's documents: reading them for the admin, saving and deleting them. Every write
 * goes in one D1 batch (a transaction) with its `media_refs`, slugs and the content version
 * bump. The Hono routes in `index.ts` only parse the request and pick the response.
 */

export const saveInput = z.object({
  locale: z.string().min(2).max(10).optional(),
  status: z.enum(['draft', 'published']).optional(),
  data: z.record(z.string(), z.unknown()),
  /** Translated locales only: keys of machine translations an editor approved. */
  approve: z.array(z.string().max(200)).max(500).optional(),
})
export type SaveInput = z.infer<typeof saveInput>

export interface AdminDocument {
  slug: string
  locale: string
  status: 'draft' | 'published'
  data: Record<string, unknown>
  /** Translated locales: the state of each translatable text, keyed by its path. */
  translations: Translations | null
  updatedAt: number
}

/** One locale's row of a save. */
export interface SaveRow {
  locale: string
  data: Record<string, unknown>
  translations: Translations | null
  mediaIds: string[]
  /** Keys of texts to translate once the save is in D1. */
  todo: string[]
}

/** Why a save was refused, as the HTTP status the admin gets and what to show. */
export interface SaveFailure {
  error: 400 | 404 | 409 | 422
  issues?: unknown
}

/** A save that went through: its slug and rows (`todo` says what to translate next). */
export interface Saved {
  slug: string
  rows: SaveRow[]
}

const isCollection = (config: CmsConfig, type: string) => Object.hasOwn(config.collections, type)

/** A type the API knows: a collection, a singleton or, if the site has pages, "pages". */
export function isDocumentType(config: CmsConfig, type: string) {
  return (
    isCollection(config, type) ||
    Object.hasOwn(config.singletons ?? {}, type) ||
    (Object.keys(config.pages ?? {}).length > 0 && type === PAGES_TYPE)
  )
}

/** Locales translated from the default one. */
const targetLocales = (config: CmsConfig) =>
  config.site.locales.filter((l) => l !== config.site.defaultLocale)

// ---------- admin reads ----------

const adminColumns = {
  slug: documents.slug,
  locale: documents.locale,
  status: documents.status,
  data: documents.data,
  translations: documents.translations,
  updatedAt: documents.updatedAt,
}

const toAdmin = (row: { updatedAt: Date } & Omit<AdminDocument, 'updatedAt'>): AdminDocument => ({
  ...row,
  updatedAt: row.updatedAt.getTime(),
})

/** Every document of a type in one locale, drafts included, in order. */
export async function listDocuments(db: Db, type: string, locale: string) {
  const rows = await db
    .select(adminColumns)
    .from(documents)
    .where(and(eq(documents.type, type), eq(documents.locale, locale)))
    .orderBy(asc(documents.sort), asc(documents.createdAt))
  return rows.map(toAdmin)
}

/** One locale of one document, or null. */
export async function getDocument(db: Db, type: string, slug: string, locale: string) {
  const row = await db
    .select(adminColumns)
    .from(documents)
    .where(and(eq(documents.type, type), eq(documents.slug, slug), eq(documents.locale, locale)))
    .get()
  return row ? toAdmin(row) : null
}

// ---------- saves ----------

/** Every locale's row of one document. */
const localeRows = (db: Db, type: string, slug: string) =>
  db
    .select({
      locale: documents.locale,
      status: documents.status,
      data: documents.data,
      translations: documents.translations,
    })
    .from(documents)
    .where(and(eq(documents.type, type), eq(documents.slug, slug)))

const rowOf = (row: LocaleRow & { todo: string[] }, locale: string, fields: Fields): SaveRow => ({
  locale,
  data: row.data,
  translations: row.translations,
  mediaIds: mediaIdsOf(fields, row.data),
  todo: row.todo,
})

const rowValues = (r: SaveRow) => ({
  data: r.data,
  translations: r.translations,
  needsReview: r.translations ? needsReview(r.translations) : false,
})

/**
 * Fills the `slug()` fields of a save. A slug is shared by every locale of a document. Until
 * the document is first published it is made from its `from` field in the default locale,
 * with a number added if another document of the type has it; after that it never changes.
 * Whatever the client sent is ignored. Returns the slugs to write to every locale's row.
 *
 * The uniqueness check reads before the write, so two saves at the same moment could take
 * the same slug. Vefstjórn has one editor per site; a unique index would need one per field.
 */
async function resolveSlugs(
  db: Db,
  input: { type: string; id: string | null; locale: string; defaultLocale: string },
  fields: Fields,
  data: Record<string, unknown>,
): Promise<Record<string, string>> {
  const slugFields = Object.entries(fields).flatMap(([name, f]) =>
    f.kind === 'slug' && isIdentifier(name)
      ? [[name, (f as { from?: string }).from ?? ''] as const]
      : [],
  )
  if (slugFields.length === 0) return {}

  const rows = input.id
    ? await db
        .select({
          locale: documents.locale,
          data: documents.data,
          publishedAt: documents.publishedAt,
        })
        .from(documents)
        .where(and(eq(documents.type, input.type), eq(documents.slug, input.id)))
    : []
  const locked = rows.some((r) => r.publishedAt !== null)
  const own = rows.find((r) => r.locale === input.defaultLocale)

  const out: Record<string, string> = {}
  for (const [name, from] of slugFields) {
    Reflect.deleteProperty(data, name)
    const kept = own?.data[name] ?? rows.find((r) => typeof r.data[name] === 'string')?.data[name]
    if (typeof kept === 'string' && kept && (locked || input.locale !== input.defaultLocale)) {
      out[name] = kept
      continue
    }
    // Made from the default locale only: an item created in another locale waits for it.
    const source = input.locale === input.defaultLocale ? data[from] : own?.data[from]
    const base = slugify(typeof source === 'string' ? source : '')
    if (!base) continue
    const taken = await db
      .select({ value: sql<string | null>`json_extract(${documents.data}, ${`$.${name}`})` })
      .from(documents)
      .where(
        and(
          eq(documents.type, input.type),
          input.id ? sql`${documents.slug} <> ${input.id}` : undefined,
        ),
      )
    out[name] = uniqueSlug(base, new Set(taken.flatMap((r) => (r.value ? [r.value] : []))))
  }
  Object.assign(data, out)
  return out
}

/** Writes slugs into every locale's row of a document. */
function setSlugs(db: Db, type: string, id: string, slugs: Record<string, string>) {
  const entries = Object.entries(slugs)
  if (entries.length === 0) return []
  const set = entries.reduce(
    (expr, [name, value]) => sql`json_set(${expr}, ${`$.${name}`}, ${value})`,
    sql`${documents.data}`,
  )
  return [
    db
      .update(documents)
      .set({ data: set })
      .where(and(eq(documents.type, type), eq(documents.slug, id))),
  ]
}

/** Replaces the `media_refs` of one locale of a document. */
function setRefs(db: Db, doc: { type: string; slug: string; locale: string }, ids: string[]) {
  return [
    db
      .delete(mediaRefs)
      .where(
        and(
          eq(mediaRefs.docType, doc.type),
          eq(mediaRefs.docSlug, doc.slug),
          eq(mediaRefs.locale, doc.locale),
        ),
      ),
    ...(ids.length
      ? [
          db.insert(mediaRefs).values(
            ids.map((mediaId) => ({
              mediaId,
              docType: doc.type,
              docSlug: doc.slug,
              locale: doc.locale,
            })),
          ),
        ]
      : []),
  ]
}

/**
 * Validates a save against the type's fields and works out every row it writes. A save in
 * the default locale also rebuilds every other locale's row from it; a save in another
 * locale only changes that locale's translatable texts.
 */
async function planSave(
  db: Db,
  config: CmsConfig,
  type: string,
  id: string | null,
  input: SaveInput,
): Promise<
  SaveFailure | { status: 'draft' | 'published'; slugs: Record<string, string>; rows: SaveRow[] }
> {
  const fields = fieldsOfDocument(config, type, id)
  if (!fields) return { error: 404 }
  const { defaultLocale } = config.site
  const locale = input.locale ?? defaultLocale
  if (!config.site.locales.includes(locale)) {
    return { error: 400, issues: { errors: ['Unknown locale'] } }
  }

  if (locale !== defaultLocale) {
    // A translation follows its source: it can't exist, or change status, on its own.
    const rows = id ? await localeRows(db, type, id) : []
    const source = rows.find((r) => r.locale === defaultLocale)
    if (!source) return { error: 409, issues: 'sourceFirst' }
    const own = rows.find((r) => r.locale === locale)
    const prev = own
      ? { data: own.data, translations: own.translations ?? {} }
      : planLocale(fields, source.data, null)
    const edited = editLocale(fields, source.data, prev, input.data, input.approve)
    const data = schemaOf(fields).safeParse(edited.data)
    if (!data.success) return { error: 422, issues: z.treeifyError(data.error) }
    return {
      status: source.status,
      slugs: {},
      rows: [rowOf({ ...edited, data: data.data }, locale, fields)],
    }
  }

  const data = schemaOf(fields).safeParse(input.data)
  if (!data.success) return { error: 422, issues: z.treeifyError(data.error) }
  // Only collections with `drafts: true` can hold Drög; everything else goes live on save.
  const drafts = isCollection(config, type) && config.collections[type]?.drafts === true
  const status = drafts ? (input.status ?? 'draft') : 'published'
  const values = data.data as Record<string, unknown>
  const mediaIds = mediaIdsOf(fields, values)
  if (mediaIds.length) {
    const known = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))
    if (known.length !== mediaIds.length) return { error: 422, issues: 'unknownMedia' }
  }
  const slugs = await resolveSlugs(db, { type, id, locale, defaultLocale }, fields, values)
  const existing = id ? await localeRows(db, type, id) : []
  const targets = targetLocales(config).map((target) => {
    const own = existing.find((r) => r.locale === target)
    const prev = own ? { data: own.data, translations: own.translations ?? {} } : null
    return rowOf(planLocale(fields, values, prev), target, fields)
  })
  const main: SaveRow = { locale, data: values, translations: null, mediaIds, todo: [] }
  return { status, slugs, rows: [main, ...targets] }
}

/** Creates a collection item, last in its order. */
export async function createDocument(
  db: Db,
  config: CmsConfig,
  type: string,
  input: SaveInput,
): Promise<SaveFailure | Saved> {
  if (!isCollection(config, type)) return { error: 404, issues: 'Unknown collection' }
  const save = await planSave(db, config, type, null, input)
  if ('error' in save) return save

  const slug = crypto.randomUUID()
  const now = new Date()
  // In the insert itself, so two items created at once can't both take the same place. The
  // first row's subquery sees the table before this insert; the others copy its value.
  const [first, ...rest] = save.rows
  if (!first) return { error: 400 }
  const row = (r: SaveRow, sort: ReturnType<typeof sql<number>>) => ({
    id: crypto.randomUUID(),
    type,
    slug,
    locale: r.locale,
    status: save.status,
    ...rowValues(r),
    sort,
    updatedAt: now,
    publishedAt: save.status === 'published' ? now : null,
  })
  const next = sql<number>`(select coalesce(max(${documents.sort}), -1) + 1 from ${documents} where ${documents.type} = ${type})`
  const same = sql<number>`(select ${documents.sort} from ${documents} where ${documents.type} = ${type} and ${documents.slug} = ${slug} and ${documents.locale} = ${first.locale})`
  await db.batch([
    db.insert(documents).values(row(first, next)),
    ...(rest.length ? [db.insert(documents).values(rest.map((r) => row(r, same)))] : []),
    ...save.rows.flatMap((r) => setRefs(db, { type, slug, locale: r.locale }, r.mediaIds)),
    bumpContentVersion(db),
  ])
  return { slug, rows: save.rows }
}

/** Saves one locale of a document; a singleton or page is created on its first save. */
export async function updateDocument(
  db: Db,
  config: CmsConfig,
  type: string,
  slug: string,
  input: SaveInput,
): Promise<SaveFailure | Saved> {
  const save = await planSave(db, config, type, slug, input)
  if ('error' in save) return save

  const ofDoc = and(eq(documents.type, type), eq(documents.slug, slug))
  if (isCollection(config, type)) {
    // Collection items are created with `createDocument`.
    const exists = await db.select({ slug: documents.slug }).from(documents).where(ofDoc).get()
    if (!exists) return { error: 404, issues: 'Not found' }
  }

  const now = new Date()
  const upserts = save.rows.map((r) => {
    const row = { ...rowValues(r), status: save.status, updatedAt: now }
    return db
      .insert(documents)
      .values({ id: crypto.randomUUID(), type, slug, locale: r.locale, ...row })
      .onConflictDoUpdate({ target: [documents.type, documents.slug, documents.locale], set: row })
  })
  await db.batch([
    bumpContentVersion(db),
    ...upserts,
    // Drög/Birt belongs to the document, so every locale follows it.
    db.update(documents).set({ status: save.status }).where(ofDoc),
    db
      .update(documents)
      .set({ publishedAt: now })
      .where(and(ofDoc, eq(documents.status, 'published'), sql`${documents.publishedAt} is null`)),
    ...setSlugs(db, type, slug, save.slugs),
    ...save.rows.flatMap((r) => setRefs(db, { type, slug, locale: r.locale }, r.mediaIds)),
  ])
  return { slug, rows: save.rows }
}

/** Deletes a collection item in every locale. Returns false for a type that isn't one. */
export async function deleteDocument(db: Db, config: CmsConfig, type: string, slug: string) {
  if (!isCollection(config, type)) return false
  await db.batch([
    db.delete(mediaRefs).where(and(eq(mediaRefs.docType, type), eq(mediaRefs.docSlug, slug))),
    db.delete(documents).where(and(eq(documents.type, type), eq(documents.slug, slug))),
    bumpContentVersion(db),
  ])
  return true
}
