import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { type Context, Hono } from 'hono'
import { z } from 'zod'

import { documents, enquiries, media, mediaRefs, siteMeta } from '../db/schema'
import { type CmsConfig, type DocOf, pageFields, type PageOf, PAGES_SCREEN } from '../define'
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
import { verifyAccessJwt } from './access'
import { masterFromRaw, type MediaFailure, putRaw, storeBrowserMaster } from './media'
import {
  bumpContentVersion,
  fakeTranslator,
  retryPendingTranslations,
  translateDocument,
  type Translator,
  workersAiTranslator,
} from './translate'

export { createImageRoute, hasMetadata, mediaByIds, negotiateFormat, stripMetadata } from './media'
export {
  fakeTranslator,
  TRANSLATION_MODELS,
  TranslationError,
  type Translator,
  workersAiTranslator,
} from './translate'

export interface CmsBindings {
  DB: D1Database
  MEDIA: R2Bucket
  /** Cloudflare Images: master conversion, blurred previews and `/img` widths. */
  IMAGES?: ImagesBinding
  /** "production" turns on the Cloudflare Access check. */
  ENVIRONMENT?: string
  /** Cloudflare Access team domain, e.g. "norduo.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string
  /** AUD tag of the site's Access application. */
  ACCESS_AUD?: string
  /** Workers AI: machine translation of translatable fields after a save. */
  AI?: Ai
  /** "fake" translates with `fakeTranslator` (local development and e2e, which have no AI). */
  TRANSLATOR?: string
}

export interface CmsHooks {
  /** Called after a quote enquiry is saved, e.g. to email it. */
  onEnquiry?: (enquiry: EnquiryInput, env: CmsBindings) => Promise<void> | void
  /** Replaces the translator picked from the bindings (tests). */
  translator?: Translator
}

/** The translator for this request: the hook's, the fake one, Workers AI, or none. */
function translatorFor(config: CmsConfig, env: CmsBindings, hooks: CmsHooks): Translator | null {
  if (hooks.translator) return hooks.translator
  if (env.TRANSLATOR === 'fake') return fakeTranslator
  return env.AI ? workersAiTranslator(env.AI, config.translation) : null
}

export const enquiryInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z.string().trim().max(40).optional(),
  service: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1).max(5000),
})
export type EnquiryInput = z.infer<typeof enquiryInput>

const saveInput = z.object({
  locale: z.string().min(2).max(10).optional(),
  status: z.enum(['draft', 'published']).optional(),
  data: z.record(z.string(), z.unknown()),
  /** Translated locales only: keys of machine translations an editor approved. */
  approve: z.array(z.string().max(200)).max(500).optional(),
})

export interface AdminDocument {
  slug: string
  locale: string
  status: 'draft' | 'published'
  data: Record<string, unknown>
  /** Translated locales: the state of each translatable text, keyed by its path. */
  translations: Translations | null
  updatedAt: number
}

const CONTENT_VERSION = 'content_version'

/** Goes up on every admin write. The site's edge cache keys pages on it. */
export async function contentVersion(db: D1Database): Promise<number> {
  const row = await drizzle(db)
    .select({ value: siteMeta.value })
    .from(siteMeta)
    .where(eq(siteMeta.key, CONTENT_VERSION))
    .get()
  return row?.value ?? 0
}

/**
 * Published items of a collection for a site loader, with only the fields the page renders.
 * Every loaded field is serialized into the hydration payload, so selecting less saves CPU
 * on Workers Free (see issue #8). Missing fields are left out of `data`.
 */
export async function listPublished<
  C extends CmsConfig,
  K extends keyof C['collections'] & string,
  F extends keyof DocOf<C, K> & string,
>(
  db: D1Database,
  config: C,
  type: K,
  options: { fields: readonly F[]; locale?: string },
): Promise<{ slug: string; data: Partial<Pick<DocOf<C, K>, F>> }[]> {
  const known = Object.keys(config.collections[type]?.fields ?? {})
  // Names go into SQL, so only plain identifiers from the config are used.
  const fields = options.fields.filter((f) => known.includes(f) && /^[A-Za-z_]\w*$/.test(f))
  const projection = fields.length
    ? `json_object(${fields.map((f) => `'${f}', json_extract(data, '$.${f}')`).join(', ')})`
    : "'{}'"
  const { results } = await db
    .prepare(
      `select slug, ${projection} as data from documents
       where type = ? and locale = ? and status = 'published'
       order by sort, created_at`,
    )
    .bind(type, options.locale ?? config.site.defaultLocale)
    .all<{ slug: string; data: string }>()
  return results.map((row) => ({
    slug: row.slug,
    data: Object.fromEntries(
      Object.entries(JSON.parse(row.data) as Record<string, unknown>).filter(([, v]) => v !== null),
    ) as Partial<Pick<DocOf<C, K>, F>>,
  }))
}

/**
 * A page's saved content for a site loader: header fields, `seo` and `blocks`, or null
 * before its first save. Pages go live on save, so there is no draft to skip.
 */
export async function getPage<
  C extends CmsConfig,
  K extends keyof NonNullable<C['pages']> & string,
>(
  db: D1Database,
  config: C,
  name: K,
  options: { locale?: string } = {},
): Promise<PageOf<C, K> | null> {
  const row = await drizzle(db)
    .select({ data: documents.data })
    .from(documents)
    .where(
      and(
        eq(documents.type, PAGES_TYPE),
        eq(documents.slug, name),
        eq(documents.locale, options.locale ?? config.site.defaultLocale),
        eq(documents.status, 'published'),
      ),
    )
    .get()
  return row ? (row.data as PageOf<C, K>) : null
}

type Db = ReturnType<typeof drizzle>

/** Every page is stored under this type, with the page name as its slug. */
const PAGES_TYPE = PAGES_SCREEN

/** Fields of one document; a page's depend on which page it is. */
function fieldsOfDocument(config: CmsConfig, type: string, slug: string | null) {
  const singletons = config.singletons ?? {}
  const pages = config.pages ?? {}
  if (Object.hasOwn(config.collections, type)) return config.collections[type]?.fields
  if (Object.hasOwn(singletons, type)) return singletons[type]?.fields
  if (type === PAGES_TYPE && slug !== null && Object.hasOwn(pages, slug))
    return pageFields(config, slug)
  return undefined
}

/** Locales translated from the default one. */
const targetLocales = (config: CmsConfig) =>
  config.site.locales.filter((l) => l !== config.site.defaultLocale)

/**
 * Nightly: translates every text still pending, e.g. after the day's free AI allowance ran
 * out (it resets at 00:00 UTC). Call it from the site's `scheduled` handler.
 */
export async function retryTranslations(config: CmsConfig, env: CmsBindings, hooks: CmsHooks = {}) {
  const translate = translatorFor(config, env, hooks)
  if (!translate) return
  await retryPendingTranslations(env.DB, config, translate, (type, slug) =>
    fieldsOfDocument(config, type, slug),
  )
}

/** Names in SQL JSON paths come from the config; only plain identifiers are allowed. */
const isIdentifier = (name: string) => /^[A-Za-z_]\w*$/.test(name)

/**
 * Fills the `slug()` fields of a save. A slug is shared by every locale of a document. Until
 * the document is first published it is made from its `from` field in the default locale,
 * with a number added if another document of the type has it; after that it never changes.
 * Whatever the client sent is ignored. Returns the slugs to write to every locale's row.
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
 * Hono app with the CMS API. A site mounts it, e.g. `app.route('/api/cms', createCmsApi(cms))`.
 * Public routes: GET published content, POST /enquiries.
 * Admin routes (/admin/*) sit behind Cloudflare Access.
 */
export function createCmsApi(config: CmsConfig, hooks: CmsHooks = {}) {
  const app = new Hono<{ Bindings: CmsBindings }>()

  const collections = config.collections
  const singletons = config.singletons ?? {}
  const pages = config.pages ?? {}
  const hasPages = Object.keys(pages).length > 0
  /** A type the API knows: a collection, a singleton or, if the site has pages, "pages". */
  const isType = (type: string) =>
    Object.hasOwn(collections, type) ||
    Object.hasOwn(singletons, type) ||
    (hasPages && type === PAGES_TYPE)
  const fieldsOf = (type: string, slug: string | null) => fieldsOfDocument(config, type, slug)
  /** Only collections with `drafts: true` can hold Drög; everything else goes live on save. */
  const hasDrafts = (type: string) =>
    Object.hasOwn(collections, type) && collections[type]?.drafts === true
  const isLocale = (locale: string) => config.site.locales.includes(locale)
  const localeOf = (c: { req: { query: (k: string) => string | undefined } }) =>
    c.req.query('locale') ?? config.site.defaultLocale

  app.get('/health', (c) => c.json({ ok: true, site: config.site.id }))

  // ---------- public ----------

  app.get('/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!isType(type)) return c.json({ error: 'Unknown type' }, 404)
    const locale = localeOf(c)
    const rows = await drizzle(c.env.DB)
      .select({ slug: documents.slug, data: documents.data })
      .from(documents)
      .where(
        and(
          eq(documents.type, type),
          eq(documents.locale, locale),
          eq(documents.status, 'published'),
        ),
      )
      .orderBy(asc(documents.sort), asc(documents.createdAt))
    return c.json(rows)
  })

  app.post('/enquiries', async (c) => {
    const parsed = enquiryInput.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 400)
    await drizzle(c.env.DB)
      .insert(enquiries)
      .values({ id: crypto.randomUUID(), ...parsed.data })
    await hooks.onEnquiry?.(parsed.data, c.env)
    return c.json({ ok: true }, 201)
  })

  // ---------- admin ----------

  app.use('/admin/*', async (c, next) => {
    // Cloudflare Access sits in front of /vefstjorn and /api/cms/admin; the Worker checks its
    // signed token too, so a forged header or a request that bypasses Access gets nowhere.
    if (c.env.ENVIRONMENT === 'production') {
      const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud } = c.env
      const email =
        teamDomain && aud
          ? await verifyAccessJwt(c.req.header('cf-access-jwt-assertion'), { teamDomain, aud })
          : null
      if (email === null) return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  app.get('/admin/config', (c) =>
    c.json({
      site: config.site,
      admin: config.admin ?? {},
      collections: Object.keys(collections),
      singletons: Object.keys(singletons),
      pages: Object.keys(pages),
    }),
  )

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

  app.get('/admin/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!isType(type)) return c.json({ error: 'Unknown type' }, 404)
    const locale = localeOf(c)
    const rows = await drizzle(c.env.DB)
      .select(adminColumns)
      .from(documents)
      .where(and(eq(documents.type, type), eq(documents.locale, locale)))
      .orderBy(asc(documents.sort), asc(documents.createdAt))
    return c.json(rows.map(toAdmin))
  })

  app.get('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!fieldsOf(type, slug)) return c.json({ error: 'Unknown type' }, 404)
    const locale = localeOf(c)
    const row = await drizzle(c.env.DB)
      .select(adminColumns)
      .from(documents)
      .where(and(eq(documents.type, type), eq(documents.slug, slug), eq(documents.locale, locale)))
      .get()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json(toAdmin(row))
  })

  /** One locale's row of a save. */
  interface SaveRow {
    locale: string
    data: Record<string, unknown>
    translations: Translations | null
    mediaIds: string[]
    /** Keys of texts to translate once the save is in D1. */
    todo: string[]
  }

  const rowOf = (row: LocaleRow & { todo: string[] }, locale: string, fields: Fields): SaveRow => ({
    locale,
    data: row.data,
    translations: row.translations,
    mediaIds: mediaIdsOf(fields, row.data),
    todo: row.todo,
  })

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

  /**
   * Validates a save body against the type's fields, or returns an error response. A save in
   * the default locale also rebuilds every other locale's row from it; a save in another
   * locale only changes that locale's translatable texts.
   */
  async function readSave(
    c: { req: { json: () => Promise<unknown> }; env: CmsBindings },
    type: string,
    id: string | null,
  ) {
    const fields = fieldsOf(type, id)
    if (!fields) return { error: 404 as const }
    const body = saveInput.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return { error: 400 as const, issues: z.treeifyError(body.error) }
    const locale = body.data.locale ?? config.site.defaultLocale
    if (!isLocale(locale)) return { error: 400 as const, issues: { errors: ['Unknown locale'] } }
    const db = drizzle(c.env.DB)

    if (locale !== config.site.defaultLocale) {
      // A translation follows its source: it can't exist, or change status, on its own.
      const rows = id ? await localeRows(db, type, id) : []
      const source = rows.find((r) => r.locale === config.site.defaultLocale)
      if (!source) return { error: 409 as const, issues: 'sourceFirst' as const }
      const own = rows.find((r) => r.locale === locale)
      const prev = own
        ? { data: own.data, translations: own.translations ?? {} }
        : planLocale(fields, source.data, null)
      const edited = editLocale(fields, source.data, prev, body.data.data, body.data.approve)
      const data = schemaOf(fields).safeParse(edited.data)
      if (!data.success) return { error: 422 as const, issues: z.treeifyError(data.error) }
      return {
        status: source.status,
        slugs: {},
        rows: [rowOf({ ...edited, data: data.data }, locale, fields)],
      }
    }

    const data = schemaOf(fields).safeParse(body.data.data)
    if (!data.success) return { error: 422 as const, issues: z.treeifyError(data.error) }
    const status = hasDrafts(type) ? (body.data.status ?? 'draft') : 'published'
    const values = data.data as Record<string, unknown>
    const mediaIds = mediaIdsOf(fields, values)
    if (mediaIds.length) {
      const known = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds))
      if (known.length !== mediaIds.length)
        return { error: 422 as const, issues: 'unknownMedia' as const }
    }
    const slugs = await resolveSlugs(
      db,
      { type, id, locale, defaultLocale: config.site.defaultLocale },
      fields,
      values,
    )
    const existing = id ? await localeRows(db, type, id) : []
    const targets = targetLocales(config).map((target) => {
      const own = existing.find((r) => r.locale === target)
      const prev = own ? { data: own.data, translations: own.translations ?? {} } : null
      return rowOf(planLocale(fields, values, prev), target, fields)
    })
    const main: SaveRow = { locale, data: values, translations: null, mediaIds, todo: [] }
    return { status, slugs, rows: [main, ...targets] }
  }

  /** Translates what a save left pending, after the response; a save never waits on it. */
  function translateLater(
    c: Context<{ Bindings: CmsBindings }>,
    type: string,
    slug: string,
    rows: SaveRow[],
  ) {
    const translate = translatorFor(config, c.env, hooks)
    const fields = fieldsOf(type, slug)
    if (!translate || !fields) return
    const work = Promise.all(
      rows
        .filter((r) => r.todo.length > 0)
        .map((r) =>
          translateDocument(c.env.DB, translate, {
            type,
            slug,
            fields,
            from: config.site.defaultLocale,
            to: r.locale,
          }),
        ),
    )
    try {
      c.executionCtx.waitUntil(work)
    } catch {
      // No execution context (a plain app.request in tests): the work still runs.
    }
  }

  const rowValues = (r: SaveRow) => ({
    data: r.data,
    translations: r.translations,
    needsReview: r.translations ? needsReview(r.translations) : false,
  })

  app.post('/admin/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!Object.hasOwn(collections, type)) return c.json({ error: 'Unknown collection' }, 404)
    const save = await readSave(c, type, null)
    if ('error' in save) return c.json({ error: save.issues ?? 'Unknown type' }, save.error)

    const db = drizzle(c.env.DB)
    const slug = crypto.randomUUID()
    const last = await db
      .select({ sort: max(documents.sort) })
      .from(documents)
      .where(eq(documents.type, type))
      .get()
    const now = new Date()
    await db.batch([
      db.insert(documents).values(
        save.rows.map((r) => ({
          id: crypto.randomUUID(),
          type,
          slug,
          locale: r.locale,
          status: save.status,
          ...rowValues(r),
          sort: (last?.sort ?? -1) + 1,
          updatedAt: now,
          publishedAt: save.status === 'published' ? now : null,
        })),
      ),
      ...save.rows.flatMap((r) => setRefs(db, { type, slug, locale: r.locale }, r.mediaIds)),
      bumpContentVersion(db),
    ])
    translateLater(c, type, slug, save.rows)
    return c.json({ slug }, 201)
  })

  app.put('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    const save = await readSave(c, type, slug)
    if ('error' in save) return c.json({ error: save.issues ?? 'Unknown type' }, save.error)

    const db = drizzle(c.env.DB)
    const isSingleton = Object.hasOwn(singletons, type) || type === PAGES_TYPE
    const exists = await db
      .select({ slug: documents.slug })
      .from(documents)
      .where(and(eq(documents.type, type), eq(documents.slug, slug)))
      .get()
    // Collection items are created with POST; a singleton or page is created on its first save.
    if (!exists && !isSingleton) return c.json({ error: 'Not found' }, 404)

    const now = new Date()
    const ofDoc = and(eq(documents.type, type), eq(documents.slug, slug))
    const upserts = save.rows.map((r) => {
      const row = { ...rowValues(r), status: save.status, updatedAt: now }
      return db
        .insert(documents)
        .values({ id: crypto.randomUUID(), type, slug, locale: r.locale, ...row })
        .onConflictDoUpdate({
          target: [documents.type, documents.slug, documents.locale],
          set: row,
        })
    })
    await db.batch([
      bumpContentVersion(db),
      ...upserts,
      // Drög/Birt belongs to the document, so every locale follows it.
      db.update(documents).set({ status: save.status }).where(ofDoc),
      db
        .update(documents)
        .set({ publishedAt: now })
        .where(
          and(ofDoc, eq(documents.status, 'published'), sql`${documents.publishedAt} is null`),
        ),
      ...setSlugs(db, type, slug, save.slugs),
      ...save.rows.flatMap((r) => setRefs(db, { type, slug, locale: r.locale }, r.mediaIds)),
    ])
    translateLater(c, type, slug, save.rows)
    return c.json({ ok: true })
  })

  app.delete('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!Object.hasOwn(collections, type)) return c.json({ error: 'Unknown collection' }, 404)
    const db = drizzle(c.env.DB)
    await db.batch([
      db.delete(mediaRefs).where(and(eq(mediaRefs.docType, type), eq(mediaRefs.docSlug, slug))),
      db.delete(documents).where(and(eq(documents.type, type), eq(documents.slug, slug))),
      bumpContentVersion(db),
    ])
    return c.json({ ok: true })
  })

  /** A refused upload, logged so Workers Logs show why (the admin only sees a short code). */
  const refused = (
    c: Context,
    route: string,
    { error, status }: MediaFailure,
    detail: Record<string, unknown> = {},
  ) => {
    console.warn('media upload refused', { route, error, status, ...detail })
    return c.json({ error }, status)
  }

  // Photos, one per request: the browser makes the master when it can (see admin/upload.ts).
  app.post('/admin/media', async (c) => {
    const form = await c.req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return c.json({ error: 'noFile' }, 400)
    const result = await storeBrowserMaster(c.env, file)
    if ('status' in result)
      return refused(c, 'master', result, { type: file.type, size: file.size })
    return c.json(result, 201)
  })

  // A HEIC the browser can't decode: the raw file first, then the master in its own request.
  app.post('/admin/media/raw', async (c) => {
    const result = await putRaw(c.env, c.req.raw, c.req.query('filename') ?? 'photo.heic')
    if ('status' in result) return refused(c, 'raw', result)
    return c.json(result, 201)
  })

  app.post('/admin/media/raw/:id', async (c) => {
    const result = await masterFromRaw(c.env, c.req.param('id'))
    if ('status' in result) return refused(c, 'rawMaster', result)
    return c.json(result.media, result.created ? 201 : 200)
  })

  return app
}
