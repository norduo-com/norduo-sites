import { drizzle } from 'drizzle-orm/d1'
import { type Context, Hono } from 'hono'
import { z } from 'zod'

import type { CmsConfig } from '../define'
import { verifyAccessJwt } from './access'
import {
  createDocument,
  deleteDocument,
  getDocument,
  isDocumentType,
  listDocuments,
  saveInput,
  type SaveRow,
  updateDocument,
} from './documents'
import { deleteMedia, listMedia, mediaUses, setAlt } from './library'
import { masterFromRaw, type MediaFailure, putRaw, storeBrowserMaster } from './media'
import {
  fakeTranslator,
  retryPendingTranslations,
  translateDocument,
  type Translator,
  workersAiTranslator,
} from './translate'
import { fieldsOfDocument } from './types'
import { completeVideo, presignVideo, putLocalVideo } from './video'

export { type AdminDocument } from './documents'
export { type AdminMedia, type MediaUseRef, type MediaUses } from './library'
export { createImageRoute, hasMetadata, mediaByIds, negotiateFormat, stripMetadata } from './media'
export { contentVersion, getPage, getSingleton, listPublished, pageHeaders } from './read'
export {
  fakeTranslator,
  TRANSLATION_MODELS,
  TranslationError,
  type Translator,
  workersAiTranslator,
} from './translate'
export { createVideoRoute, type VideoTicket } from './video'

export interface CmsBindings {
  DB: D1Database
  MEDIA: R2Bucket
  /** Cloudflare Images: master conversion, blurred previews and `/img` widths. */
  IMAGES?: ImagesBinding
  /** Only "development" turns the Cloudflare Access check off; anything else, or none, keeps it on. */
  ENVIRONMENT?: string
  /** Cloudflare Access team domain, e.g. "norduo.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string
  /** AUD tag of the site's Access application. */
  ACCESS_AUD?: string
  /** Workers AI: machine translation of translatable fields after a save. */
  AI?: Ai
  /** "fake" translates with `fakeTranslator` (local development and e2e, which have no AI). */
  TRANSLATOR?: string
  /** Name of the bucket behind `MEDIA`: videos are PUT to it through R2's S3 API. */
  R2_BUCKET?: string
  /** Secrets for presigned video uploads: the account and a token scoped to the bucket. */
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
}

export interface CmsHooks {
  /** Replaces the translator picked from the bindings (tests). */
  translator?: Translator
}

/** The translator for this request: the hook's, the fake one, Workers AI, or none. */
function translatorFor(config: CmsConfig, env: CmsBindings, hooks: CmsHooks): Translator | null {
  if (hooks.translator) return hooks.translator
  if (env.TRANSLATOR === 'fake') return fakeTranslator
  return env.AI ? workersAiTranslator(env.AI, config.translation) : null
}

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

/**
 * Hono app with the CMS API. A site mounts it, e.g. `app.route('/api/cms', createCmsApi(cms))`.
 * Admin routes (/admin/*) sit behind Cloudflare Access. Site loaders read published content
 * with `getPage` and `listPublished` (`read.ts`), so there is no public content route to leak
 * fields. Routes only parse requests and pick responses: documents are read and written in
 * `documents.ts`, Myndasafn in `library.ts`.
 */
export function createCmsApi(config: CmsConfig, hooks: CmsHooks = {}) {
  const app = new Hono<{ Bindings: CmsBindings }>()

  const collections = config.collections
  const singletons = config.singletons ?? {}
  const pages = config.pages ?? {}
  const fieldsOf = (type: string, slug: string | null) => fieldsOfDocument(config, type, slug)
  const localeOf = (c: { req: { query: (k: string) => string | undefined } }) =>
    c.req.query('locale') ?? config.site.defaultLocale

  app.get('/health', (c) => c.json({ ok: true, site: config.site.id }))

  // ---------- admin ----------

  app.use('/admin/*', async (c, next) => {
    // Cloudflare Access sits in front of /vefstjorn and /api/cms/admin; the Worker checks its
    // signed token too, so a forged header or a request that bypasses Access gets nowhere.
    // Fails closed: only an explicit "development" skips the check, so a missing or misspelled
    // ENVIRONMENT never opens the admin.
    if (c.env.ENVIRONMENT !== 'development') {
      const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud } = c.env
      const email =
        teamDomain && aud
          ? await verifyAccessJwt(c.req.header('cf-access-jwt-assertion'), { teamDomain, aud })
          : null
      if (email === null) return c.json({ error: 'Unauthorized' }, 401)
    }
    await next()
  })

  // Throws on purpose, to check that the site's error reporting sees Worker errors.
  app.get('/admin/debug/error', () => {
    throw new Error('Vefstjórn test error (GET /admin/debug/error)')
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

  app.get('/admin/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!isDocumentType(config, type)) return c.json({ error: 'Unknown type' }, 404)
    return c.json(await listDocuments(drizzle(c.env.DB), type, localeOf(c)))
  })

  app.get('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!fieldsOf(type, slug)) return c.json({ error: 'Unknown type' }, 404)
    const doc = await getDocument(drizzle(c.env.DB), type, slug, localeOf(c))
    if (!doc) return c.json({ error: 'Not found' }, 404)
    return c.json(doc)
  })

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

  /** The parsed save body, or the 400 to answer with. */
  const readBody = async (c: Context) => {
    const body = saveInput.safeParse(await c.req.json().catch(() => null))
    return body.success ? body.data : { error: 400 as const, issues: z.treeifyError(body.error) }
  }

  app.post('/admin/content/:type', async (c) => {
    const type = c.req.param('type')
    if (!Object.hasOwn(collections, type)) return c.json({ error: 'Unknown collection' }, 404)
    const input = await readBody(c)
    if ('error' in input) return c.json({ error: input.issues }, input.error)
    const saved = await createDocument(drizzle(c.env.DB), config, type, input)
    if ('error' in saved) return c.json({ error: saved.issues ?? 'Unknown type' }, saved.error)
    translateLater(c, type, saved.slug, saved.rows)
    return c.json({ slug: saved.slug }, 201)
  })

  app.put('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!fieldsOf(type, slug)) return c.json({ error: 'Unknown type' }, 404)
    const input = await readBody(c)
    if ('error' in input) return c.json({ error: input.issues }, input.error)
    const saved = await updateDocument(drizzle(c.env.DB), config, type, slug, input)
    if ('error' in saved) return c.json({ error: saved.issues ?? 'Unknown type' }, saved.error)
    translateLater(c, type, slug, saved.rows)
    return c.json({ ok: true })
  })

  app.delete('/admin/content/:type/:slug', async (c) => {
    const { type, slug } = c.req.param()
    if (!(await deleteDocument(drizzle(c.env.DB), config, type, slug)))
      return c.json({ error: 'Unknown collection' }, 404)
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

  // Videos: a presigned URL first, the browser PUTs the MP4 straight to R2, then the row.
  app.post('/admin/media/video', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { size?: unknown; type?: unknown } | null
    const input = { size: body?.size, type: body?.type }
    const result = await presignVideo(
      c.env,
      input,
      (id, size) => `${c.req.path}/${id}/local?size=${String(size)}`,
    )
    if ('status' in result) return refused(c, 'videoUrl', result, input)
    return c.json(result, 201)
  })

  // Stands in for R2 when there is no S3 token (local dev and tests only).
  app.put('/admin/media/video/:id/local', async (c) => {
    const result = await putLocalVideo(
      c.env,
      c.req.raw,
      c.req.param('id'),
      Number(c.req.query('size')),
    )
    if ('status' in result) return c.json({ error: result.error }, result.status)
    return c.json(result)
  })

  app.post('/admin/media/video/:id', async (c) => {
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
    const result = await completeVideo(c.env, c.req.param('id'), body)
    if ('status' in result) return refused(c, 'video', result)
    return c.json(result.media, result.created ? 201 : 200)
  })

  // ---------- Myndasafn ----------

  app.get('/admin/media', async (c) => c.json(await listMedia(drizzle(c.env.DB))))

  const altInput = z.object({ alt: z.string().trim().max(300) })

  app.patch('/admin/media/:id', async (c) => {
    const body = altInput.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: z.treeifyError(body.error) }, 400)
    if (!(await setAlt(drizzle(c.env.DB), c.req.param('id'), body.data.alt)))
      return c.json({ error: 'notFound' }, 404)
    return c.json({ ok: true })
  })

  app.get('/admin/media/:id/uses', async (c) => {
    const uses = await mediaUses(drizzle(c.env.DB), config, c.req.param('id'))
    if (!uses) return c.json({ error: 'notFound' }, 404)
    return c.json(uses)
  })

  app.delete('/admin/media/:id', async (c) => {
    const result = await deleteMedia(drizzle(c.env.DB), c.env.MEDIA, config, c.req.param('id'), {
      removeFromGalleries: c.req.query('galleries') === 'remove',
    })
    if ('ok' in result) return c.json({ ok: true })
    if (result.error === 'notFound') return c.json({ error: 'notFound' }, 404)
    return c.json(result, 409)
  })

  return app
}
