import { type BlockConfig, blocks, type BlockValue, type Fields, type Infer } from './fields'
import type { SeoField, SeoValue } from './seo'

/*
 * The config holds no labels. Vefstjórn looks them up in the site's `cms` translation
 * namespace by config path, e.g. `collections.equipment.label` (see `labels.ts`).
 */

export interface CollectionConfig<F extends Fields = Fields> {
  fields: F
  /** Items are saved as Drög or Birt; only Birt ones are public. Without it, saving publishes. */
  drafts?: boolean
  /** Field used as the title in lists. */
  titleField?: keyof F & string
  /** Drag-to-reorder in lists; the order is used on the site. */
  sortable?: boolean
}

export interface SingletonConfig<F extends Fields = Fields> {
  fields: F
  /** List it in another screen instead of the menu, e.g. the footer under Síður og textar. */
  showUnder?: typeof PAGES_SCREEN
}

/**
 * One of the site's fixed pages. Editors can't create or delete pages; each one is saved
 * once per locale and goes live on save, as type "pages" with the page name as its slug, so
 * a page may share its name with a collection (a "projects" page listing the projects). Its header and `seo` are fixed fields; its body is
 * a list of blocks picked from the site's `blocks` library.
 */
export interface PageConfig<F extends Fields = Fields> {
  /** Path of the Icelandic page, e.g. "/thjonusta". None for a page the site shows itself (404). */
  route?: string
  /** The page header (eyebrow, heading, lead …), stored at the top level of the page. */
  fields: F
  /** Stored under `seo`. Its fallbacks point at header fields. */
  seo: SeoField
  /** Names of the library blocks editors can add, stored under `blocks`. */
  blocks?: readonly string[]
}

/** Built-in Vefstjórn screens; no content may take their names. */
export const PAGES_SCREEN = 'pages'
export const MEDIA_SCREEN = 'media'
const RESERVED_FIELDS = ['seo', 'blocks']

export interface CmsConfig {
  site: {
    /** Used for the Worker, D1 and R2 names, e.g. "berghald". */
    id: string
    name: string
    url: string
    locales: readonly [string, ...string[]]
    defaultLocale: string
  }
  /** Per-site branding of the admin. */
  admin?: {
    title?: string
    logo?: string
    accent?: string
    /** Menu order; defaults to collections, then singletons. */
    menu?: readonly string[]
  }
  collections: Record<string, CollectionConfig>
  singletons?: Record<string, SingletonConfig>
  /** Blocks a site's pages can be built from. */
  blocks?: Record<string, BlockConfig>
  /** The site's fixed pages, listed in Vefstjórn under Síður og textar. */
  pages?: Record<string, PageConfig>
  /**
   * What the translation model is told about the site. Translatable fields of the default
   * locale are machine translated into the other locales after each save.
   */
  translation?: {
    /** e.g. "Berghald, an Icelandic landscaping company". */
    about?: string
    /** Source term → the term to use in the translation. */
    glossary?: Record<string, string>
  }
}

/** An `seo()` field's fallbacks must name fields of the same owner. */
function checkSeo(owner: string, fields: Fields) {
  for (const [name, field] of Object.entries(fields)) {
    if (field.kind !== 'seo') continue
    const { titleFrom, descriptionFrom } = field as SeoField
    for (const from of [titleFrom, descriptionFrom]) {
      if (from !== undefined && !Object.hasOwn(fields, from)) {
        throw new Error(`${owner}.${name} falls back to "${from}", which isn't a field`)
      }
    }
  }
}

function checkPages(config: CmsConfig) {
  const library = config.blocks ?? {}
  const routes = new Set<string>()
  for (const [name, page] of Object.entries(config.pages ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
      throw new Error(`Page name "${name}" must be camelCase letters and digits`)
    }
    if (page.route !== undefined) {
      if (!page.route.startsWith('/')) throw new Error(`Page "${name}": route must start with /`)
      if (routes.has(page.route)) throw new Error(`Route "${page.route}" is used by two pages`)
      routes.add(page.route)
    }
    for (const field of RESERVED_FIELDS) {
      if (Object.hasOwn(page.fields, field)) {
        throw new Error(`Page "${name}" can't have a header field named "${field}"`)
      }
    }
    checkSeo(`Page "${name}"`, { ...page.fields, seo: page.seo })
    for (const b of page.blocks ?? []) {
      if (!Object.hasOwn(library, b)) throw new Error(`Page "${name}" allows unknown block "${b}"`)
    }
  }
}

const pageFieldsCache = new WeakMap<PageConfig, Fields>()

/** Every field of a page: its header, `seo` and, if it allows any, `blocks`. */
export function pageFields(config: CmsConfig, name: string): Fields {
  const page = config.pages && Object.hasOwn(config.pages, name) ? config.pages[name] : undefined
  if (!page) throw new Error(`Unknown page "${name}"`)
  const cached = pageFieldsCache.get(page)
  if (cached) return cached
  const library = config.blocks ?? {}
  const allowed = Object.fromEntries(
    (page.blocks ?? []).flatMap((b) => (Object.hasOwn(library, b) ? [[b, library[b]]] : [])),
  ) as Record<string, BlockConfig>
  const fields: Fields = {
    ...page.fields,
    seo: page.seo,
    ...(Object.keys(allowed).length ? { blocks: blocks(allowed) } : {}),
  }
  pageFieldsCache.set(page, fields)
  return fields
}

/** Identity helper that keeps the literal types of the config. */
export function defineCms<const C extends CmsConfig>(config: C): C {
  const screens: string[] = [PAGES_SCREEN, MEDIA_SCREEN]
  for (const [name, collection] of Object.entries(config.collections)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Collection name "${name}" must be lowercase letters, digits and dashes`)
    }
    if (screens.includes(name))
      throw new Error(`Collection "${name}" has a Vefstjórn screen's name`)
    for (const [field, def] of Object.entries(collection.fields)) {
      const from = def.kind === 'slug' ? (def as { from?: string }).from : undefined
      if (from !== undefined && !Object.hasOwn(collection.fields, from)) {
        throw new Error(`Slug "${name}.${field}" is made from "${from}", which isn't a field`)
      }
    }
    checkSeo(name, collection.fields)
  }
  for (const [name, singleton] of Object.entries(config.singletons ?? {})) {
    if (Object.hasOwn(config.collections, name) || screens.includes(name)) {
      throw new Error(`Singleton "${name}" has the name of another type`)
    }
    checkSeo(name, singleton.fields)
  }
  checkPages(config)
  if (!config.site.locales.includes(config.site.defaultLocale)) {
    throw new Error(`defaultLocale "${config.site.defaultLocale}" is not in locales`)
  }
  return config
}

/** Content type of a collection, e.g. `DocOf<typeof cms, 'projects'>`. */
export type DocOf<C extends CmsConfig, K extends keyof C['collections']> = Infer<
  C['collections'][K]['fields']
>

export type SingletonOf<C extends CmsConfig, K extends keyof NonNullable<C['singletons']>> = Infer<
  NonNullable<C['singletons']>[K]['fields']
>

/** Content type of a page: its header fields, `seo` and `blocks`. */
export type PageOf<C extends CmsConfig, K extends keyof NonNullable<C['pages']>> = Infer<
  NonNullable<C['pages']>[K]['fields']
> & {
  seo?: SeoValue
  blocks?: BlockValue<NonNullable<C['blocks']>>[]
}
