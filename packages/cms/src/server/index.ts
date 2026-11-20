import { and, asc, eq, max, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { z } from 'zod'

import { documents, enquiries, media, siteMeta } from '../db/schema'
import type { CmsConfig, DocOf } from '../define'
import { type Fields, schemaOf } from '../fields'
import { slugify, uniqueSlug } from '../slug'
import { verifyAccessJwt } from './access'

export interface CmsBindings {
  DB: D1Database
  MEDIA: R2Bucket
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

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

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

type Db = ReturnType<typeof drizzle>

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
    const source = input.locale === input.defaultLocale || !own ? data[from] : own.data[from]
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

/**
 * Hono app with the CMS API. A site mounts it, e.g. `app.route('/api/cms', createCmsApi(cms))`.
 * Public routes: GET published content, POST /enquiries.
 * Admin routes (/admin/*) sit behind Cloudflare Access.
 */
export function createCmsApi(config: CmsConfig, hooks: CmsHooks = {}) {
  const app = new Hono<{ Bindings: CmsBindings }>()

  const collections = config.collections
  const singletons = config.singletons ?? {}
  const fieldsOf = (type: string) =>
    Object.hasOwn(collections, type)
      ? collections[type]?.fields
      : Object.hasOwn(singletons, type)
        ? singletons[type]?.fields
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
    if (!fieldsOf(type)) return c.json({ error: 'Unknown type' }, 404)
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
    if (!fieldsOf(type)) return c.json({ error: 'Unknown type' }, 404)
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
    if (!fieldsOf(type)) return c.json({ error: 'Unknown type' }, 404)
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
    const fields = fieldsOf(type)
    if (!fields) return { error: 404 as const }
    const body = saveInput.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return { error: 400 as const, issues: z.treeifyError(body.error) }
    const locale = body.data.locale ?? config.site.defaultLocale
    if (!isLocale(locale)) return { error: 400 as const, issues: { errors: ['Unknown locale'] } }
    const data = schemaOf(fields).safeParse(body.data.data)
    if (!data.success) return { error: 422 as const, issues: z.treeifyError(data.error) }
    const status = hasDrafts(type) ? (body.data.status ?? 'draft') : 'published'
    const values = data.data as Record<string, unknown>
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
      bumpContentVersion(db),
    ])
    return c.json({ slug }, 201)
  })

  app.put('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    const save = await readSave(c, type, slug)
    if ('error' in save) return c.json({ error: save.issues ?? 'Unknown type' }, save.error)

    const db = drizzle(c.env.DB)
    const isSingleton = Object.hasOwn(singletons, type)
    const exists = await db
      .select({ slug: documents.slug })
      .from(documents)
      .where(and(eq(documents.type, type), eq(documents.slug, slug)))
      .get()
    // Collection items are created with POST; a singleton is created on its first save.
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
      bumpContentVersion(db),
    ])
    return c.json({ ok: true })
  })

  app.delete('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!Object.hasOwn(collections, type)) return c.json({ error: 'Unknown collection' }, 404)
    const db = drizzle(c.env.DB)
    await db.batch([
      db.delete(documents).where(and(eq(documents.type, type), eq(documents.slug, slug))),
      bumpContentVersion(db),
    ])
    return c.json({ ok: true })
  })

  app.post('/admin/media', async (c) => {
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'No file' }, 400)
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'File is larger than 100 MB' }, 413)
    if (!file.type.startsWith('image/')) return c.json({ error: 'Only images' }, 415)

    const id = crypto.randomUUID()
    const key = `originals/${id}/${file.name}`
    await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
    await drizzle(c.env.DB)
      .insert(media)
      .values({ id, key, filename: file.name, mime: file.type, size: file.size })
    return c.json({ id, key }, 201)
  })

  return app
}
