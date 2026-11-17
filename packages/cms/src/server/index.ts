import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import { z } from 'zod'

import { documents, enquiries, media } from '../db/schema'
import type { CmsConfig } from '../define'
import { schemaOf } from '../fields'

export interface CmsBindings {
  DB: D1Database
  MEDIA: R2Bucket
  /** "production" turns on the Cloudflare Access check. */
  ENVIRONMENT?: string
}

export interface CmsHooks {
  /** Called after content is published, e.g. to clear cached pages. */
  onPublish?: (info: { type: string; slug: string }, env: CmsBindings) => Promise<void> | void
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
  locale: z.string().min(2).max(10),
  data: z.record(z.string(), z.unknown()),
  needsReview: z.boolean().optional(),
})

/**
 * Hono app with the CMS API. A site mounts it, e.g. `app.route('/api/cms', createCmsApi(cms))`.
 * Public routes: GET published content, POST /enquiries.
 * Admin routes (/admin/*) sit behind Cloudflare Access.
 */
export function createCmsApi(config: CmsConfig, hooks: CmsHooks = {}) {
  const app = new Hono<{ Bindings: CmsBindings }>()

  const kinds = { ...config.collections, ...config.singletons }
  const fieldsOf = (type: string) => (Object.hasOwn(kinds, type) ? kinds[type]?.fields : undefined)

  app.get('/health', (c) => c.json({ ok: true, site: config.site.id }))

  // ---------- public ----------

  app.get('/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!fieldsOf(type)) return c.json({ error: 'Unknown type' }, 404)
    const locale = c.req.query('locale') ?? config.site.defaultLocale
    const rows = await drizzle(c.env.DB)
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.type, type),
          eq(documents.locale, locale),
          eq(documents.status, 'published'),
        ),
      )
      .orderBy(asc(documents.sort))
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
    // Cloudflare Access sits in front of /vefstjorn and /api/cms/admin.
    // TODO: verify the JWT signature against the team's Access certs, not just its presence.
    if (c.env.ENVIRONMENT === 'production' && !c.req.header('cf-access-jwt-assertion')) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  app.get('/admin/config', (c) =>
    c.json({
      site: config.site,
      admin: config.admin ?? {},
      collections: Object.fromEntries(
        Object.entries(config.collections).map(([k, v]) => [k, { label: v.label }]),
      ),
      singletons: Object.fromEntries(
        Object.entries(config.singletons ?? {}).map(([k, v]) => [k, { label: v.label }]),
      ),
    }),
  )

  app.put('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    const fields = fieldsOf(type)
    if (!fields) return c.json({ error: 'Unknown type' }, 404)
    const body = saveInput.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: z.treeifyError(body.error) }, 400)
    const data = schemaOf(fields).safeParse(body.data.data)
    if (!data.success) return c.json({ error: z.treeifyError(data.error) }, 422)

    const row = {
      type,
      slug,
      locale: body.data.locale,
      data: data.data as Record<string, unknown>,
      needsReview: body.data.needsReview ?? false,
      updatedAt: new Date(),
    }
    await drizzle(c.env.DB)
      .insert(documents)
      .values({ id: crypto.randomUUID(), status: 'draft', ...row })
      .onConflictDoUpdate({ target: [documents.type, documents.slug, documents.locale], set: row })
    return c.json({ ok: true })
  })

  app.post('/admin/content/:type/:slug/publish', async (c) => {
    const { type, slug } = c.req.param()
    if (!fieldsOf(type)) return c.json({ error: 'Unknown type' }, 404)
    await drizzle(c.env.DB)
      .update(documents)
      .set({ status: 'published', publishedAt: new Date() })
      .where(and(eq(documents.type, type), eq(documents.slug, slug)))
    await hooks.onPublish?.({ type, slug }, c.env)
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
