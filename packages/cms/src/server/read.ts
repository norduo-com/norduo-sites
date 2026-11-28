import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

import { siteMeta } from '../db/schema'
import type { CmsConfig, DocOf, PageOf, SingletonOf } from '../define'
import { withFallback } from '../locales'
import { isIdentifier, PAGES_TYPE } from './types'

/*
 * What site loaders read: published content only, straight from D1. Stored JSON is trusted;
 * the content shape check keeps the config from removing or retyping a stored field
 * (docs/architecture.md §2).
 */

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
