import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { type Context, Hono } from 'hono'
import { z } from 'zod'

import { documents, enquiries, media, mediaRefs, siteMeta } from '../db/schema'
import {
  type CmsConfig,
  type DocOf,
  pageFields,
  type PageOf,
  PAGES_SCREEN,
  type SingletonOf,
} from '../define'
import { type Fields, schemaOf } from '../fields'
import { withFallback } from '../locales'
import { mediaIdsOf } from '../media'
import { slugify, uniqueSlug } from '../slug'
import { verifyAccessJwt } from './access'
import { masterFromRaw, type MediaFailure, putRaw, storeBrowserMaster } from './media'

export { createImageRoute, hasMetadata, mediaByIds, negotiateFormat, stripMetadata } from './media'

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
}

export interface CmsHooks {
  /** Called after a quote enquiry is saved, e.g. to email it. */
  onEnquiry?: (enquiry: EnquiryInput, env: CmsBindings) => Promise<void> | void
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
  needsReview: z.boolean().optional(),
})

export interface AdminDocument {
  slug: string
  locale: string
  status: 'draft' | 'published'
  data: Record<string, unknown>
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

function bumpContentVersion(db: Db) {
  return db
    .insert(siteMeta)
    .values({ key: CONTENT_VERSION, value: 1 })
    .onConflictDoUpdate({ target: siteMeta.key, set: { value: sql`${siteMeta.value} + 1` } })
}
/** Names in SQL JSON paths come from the config; only plain identifiers are allowed. */
const isIdentifier = (name: string) => /^[A-Za-z_]\w*$/.test(name)

/**
 * Published documents of one type for a site loader, in order. In a locale other than the
 * default, each one is its default-locale row with the locale's own text laid over it field by
 * field (`withFallback`), so an item with no translation yet still shows. `fields` limits what
 * is read; every loaded field is serialized into the hydration payload, so selecting less
 * saves CPU on Workers Free (see issue #8). Missing fields are left out.
 */
async function readPublished(
  db: D1Database,
  query: {
    type: string
    slug?: string
    fields?: readonly string[]
    locale: string
    defaultLocale: string
  },
): Promise<{ slug: string; data: Record<string, unknown> }[]> {
  const fields = query.fields?.filter(isIdentifier)
  const projection = (alias: string) =>
    fields === undefined
      ? `${alias}.data`
      : fields.length
        ? `json_object(${fields.map((f) => `'${f}', json_extract(${alias}.data, '$.${f}')`).join(', ')})`
        : "'{}'"
  const translated = query.locale !== query.defaultLocale
  const { results } = await db
    .prepare(
      `select d.slug, ${projection('d')} as data${translated ? `, ${projection('l')} as own` : ''}
       from documents d
       ${translated ? "left join documents l on l.type = d.type and l.slug = d.slug and l.locale = ?1 and l.status = 'published'" : ''}
       where d.type = ?2 and d.locale = ?3 and d.status = 'published'
       ${query.slug === undefined ? '' : 'and d.slug = ?4'}
       order by d.sort, d.created_at`,
    )
    .bind(
      query.locale,
      query.type,
      query.defaultLocale,
      ...(query.slug === undefined ? [] : [query.slug]),
    )
    .all<{ slug: string; data: string; own?: string | null }>()
  const parse = (json: string | null | undefined) =>
    json
      ? Object.fromEntries(
          Object.entries(JSON.parse(json) as Record<string, unknown>).filter(([, v]) => v !== null),
        )
      : null
  return results.map((row) => ({
    slug: row.slug,
    data: withFallback(parse(row.data) ?? {}, parse(row.own)),
  }))
}

/**
 * Published items of a collection for a site loader, with only the fields the page renders,
 * in `locale` with the default locale filling any field not translated yet.
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
  const rows = await readPublished(db, {
    type,
    fields: options.fields.filter((f) => known.includes(f)),
    locale: options.locale ?? config.site.defaultLocale,
    defaultLocale: config.site.defaultLocale,
  })
  return rows as { slug: string; data: Partial<Pick<DocOf<C, K>, F>> }[]
}

/**
 * A page's saved content for a site loader: header fields, `seo` and `blocks`, or null
 * before its first save. Pages go live on save, so there is no draft to skip. In another
 * locale, fields not translated yet show the default locale's.
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
  const [row] = await readPublished(db, {
    type: PAGES_TYPE,
    slug: name,
    locale: options.locale ?? config.site.defaultLocale,
    defaultLocale: config.site.defaultLocale,
  })
  return row ? (row.data as PageOf<C, K>) : null
}

/**
 * The same few header fields of every saved page, by page name, e.g. the `title`s for the
 * site's menu. A page not saved yet is left out.
 */
export async function pageHeaders<F extends string>(
  db: D1Database,
  config: CmsConfig,
  fields: readonly F[],
  options: { locale?: string } = {},
): Promise<Partial<Record<string, Partial<Record<F, unknown>>>>> {
  const rows = await readPublished(db, {
    type: PAGES_TYPE,
    fields,
    locale: options.locale ?? config.site.defaultLocale,
    defaultLocale: config.site.defaultLocale,
  })
  return Object.fromEntries(rows.map((r) => [r.slug, r.data as Partial<Record<F, unknown>>]))
}

/** A singleton's content (only `fields`, if given) for a site loader, or null before its first save. */
export async function getSingleton<
  C extends CmsConfig,
  K extends keyof NonNullable<C['singletons']> & string,
>(
  db: D1Database,
  config: C,
  name: K,
  options: { locale?: string; fields?: readonly (keyof SingletonOf<C, K> & string)[] } = {},
): Promise<Partial<SingletonOf<C, K>> | null> {
  const [row] = await readPublished(db, {
    type: name,
    slug: name,
    ...(options.fields ? { fields: options.fields } : {}),
    locale: options.locale ?? config.site.defaultLocale,
    defaultLocale: config.site.defaultLocale,
  })
  return row ? (row.data as Partial<SingletonOf<C, K>>) : null
}

type Db = ReturnType<typeof drizzle>

/** Every page is stored under this type, with the page name as its slug. */
const PAGES_TYPE = PAGES_SCREEN

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
  /** Fields of one document; a page's depend on which page it is. */
  const fieldsOf = (type: string, slug: string | null) =>
    Object.hasOwn(collections, type)
      ? collections[type]?.fields
      : Object.hasOwn(singletons, type)
        ? singletons[type]?.fields
        : type === PAGES_TYPE && slug !== null && Object.hasOwn(pages, slug)
          ? pageFields(config, slug)
          : undefined
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

  /** Validates a save body against the type's fields, or returns an error response. */
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
    const data = schemaOf(fields).safeParse(body.data.data)
    if (!data.success) return { error: 422 as const, issues: z.treeifyError(data.error) }
    const status = hasDrafts(type) ? (body.data.status ?? 'draft') : 'published'
    const values = data.data as Record<string, unknown>
    const mediaIds = mediaIdsOf(fields, values)
    if (mediaIds.length) {
      const known = await drizzle(c.env.DB)
        .select({ id: media.id })
        .from(media)
        .where(inArray(media.id, mediaIds))
      if (known.length !== mediaIds.length)
        return { error: 422 as const, issues: 'unknownMedia' as const }
    }
    const slugs = await resolveSlugs(
      drizzle(c.env.DB),
      { type, id, locale, defaultLocale: config.site.defaultLocale },
      fields,
      values,
    )
    return {
      locale,
      status,
      slugs,
      mediaIds,
      data: values,
      needsReview: body.data.needsReview ?? false,
    }
  }

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
      db.insert(documents).values({
        id: crypto.randomUUID(),
        type,
        slug,
        locale: save.locale,
        status: save.status,
        data: save.data,
        needsReview: save.needsReview,
        sort: (last?.sort ?? -1) + 1,
        updatedAt: now,
        publishedAt: save.status === 'published' ? now : null,
      }),
      ...setRefs(db, { type, slug, locale: save.locale }, save.mediaIds),
      bumpContentVersion(db),
    ])
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
    const row = {
      data: save.data,
      needsReview: save.needsReview,
      status: save.status,
      updatedAt: now,
    }
    const ofDoc = and(eq(documents.type, type), eq(documents.slug, slug))
    await db.batch([
      db
        .insert(documents)
        .values({ id: crypto.randomUUID(), type, slug, locale: save.locale, ...row })
        .onConflictDoUpdate({
          target: [documents.type, documents.slug, documents.locale],
          set: row,
        }),
      // Drög/Birt belongs to the document, so every locale follows it.
      db.update(documents).set({ status: save.status }).where(ofDoc),
      db
        .update(documents)
        .set({ publishedAt: now })
        .where(
          and(ofDoc, eq(documents.status, 'published'), sql`${documents.publishedAt} is null`),
        ),
      ...setSlugs(db, type, slug, save.slugs),
      ...setRefs(db, { type, slug, locale: save.locale }, save.mediaIds),
      bumpContentVersion(db),
    ])
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
