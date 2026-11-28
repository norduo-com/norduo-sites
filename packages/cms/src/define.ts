import { type BlockConfig, blocks, type BlockValue, type Fields, type Infer } from './fields'
import type { SeoField, SeoValue } from './seo'

/*
 * The config holds no labels. Vefstjórn looks them up in the site's `cms` translation
 * namespace by config path, e.g. `collections.equipment.label` (see `labels.ts`).
 */

/** A document as a collection's list hooks see it. */
export interface ListedDoc<F extends Fields = Fields> {
  slug: string
  status: 'draft' | 'published'
  data: Partial<Infer<F>>
}

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning'

/** A tag on a list row. `label` is a key in the site's `cms` namespace. */
export interface Badge {
  label: string
  tone?: BadgeTone
}

/**
 * Hooks are pure functions in the config, run in Vefstjórn only. Every string they return is a
 * key in the site's `cms` namespace, so the config still holds no wording.
 */
export interface CollectionConfig<F extends Fields = Fields> {
  fields: F
  /** Items are saved as Drög or Birt; only Birt ones are public. Without it, saving publishes. */
  drafts?: boolean
  /** Field used as the title in lists. */
  titleField?: keyof F & string
  /** Drag-to-reorder in lists; the order is used on the site. */
  sortable?: boolean
  /**
   * `split` (the default): the list with the selected item's editor beside it. `table`: a
   * table of items, each opened on its own edit page.
   */
  layout?: 'split' | 'table'
  list?: {
    /** A banner above the list, e.g. which season it is; `null` for none. */
    notice?(now: Date): string | null
    /** Tags on each row, e.g. a service's seasons. */
    badge?(doc: ListedDoc<F>): Badge | readonly Badge[] | null
  }
  /** Collection-wide warnings, shown on the list and in the editor. They never block a save. */
  warnings?(docs: readonly ListedDoc<F>[]): readonly string[]
  /** A side card with a lock icon; its text is `collections.<name>.note`. */
  note?: boolean
}

export interface SingletonConfig<F extends Fields = Fields> {
  fields: F
  /** List it in another screen instead of the menu, e.g. the footer under Síður og textar. */
  showUnder?: typeof PAGES_SCREEN
  /** A side card with a lock icon; its text is `singletons.<name>.note`. */
  note?: boolean
}

/** A list hook's badges as a list. */
export function badgesOf(config: CollectionConfig, doc: ListedDoc): readonly Badge[] {
  const out = config.list?.badge?.(doc) ?? []
  return isBadgeList(out) ? out : [out]
}

const isBadgeList = (b: Badge | readonly Badge[]): b is readonly Badge[] => Array.isArray(b)

/**
 * One of the site's fixed pages. Editors can't create or delete pages; each one is saved
 * once per locale and goes live on save, as type "pages" with the page name as its slug, so
 * a page may share its name with a collection (a "projects" page listing the projects). Its header and `seo` are fixed fields; its body is
 * a list of blocks picked from the site's `blocks` library.
 */
export interface PageConfig<F extends Fields = Fields> {
  /**
   * Path of the page in the default locale, e.g. "/thjonusta". None for a page the site shows
   * itself (404). Other locales sit under `/<locale>` (see `locales.ts`).
   */
  route?: string
  /**
   * The page's path in each other locale, without the locale prefix, e.g. `{ en: '/services' }`
   * for "/en/services". Fixed in the config; editors can't change it. Required for every
   * other locale when the page has a `route`.
   */
  localeRoutes?: Readonly<Record<string, string>>
  /** The page header (eyebrow, heading, lead …), stored at the top level of the page. */
  fields: F
  /** Stored under `seo`. Its fallbacks point at header fields. */
  seo: SeoField
  /** Names of the library blocks editors can add, stored under `blocks`. */
  blocks?: readonly string[]
  /** A side card with a lock icon; its text is `pages.<name>.note`. */
  note?: boolean
}

/** Built-in Vefstjórn screens; no content may take their names. */
export const PAGES_SCREEN = 'pages'
export const MEDIA_SCREEN = 'media'
/** The path segment of a new item on a table layout's edit page; never a valid slug. */
export const NEW_ITEM = '_new'
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
  /** Per-site branding of the admin: logo, title and menu. A theme of its own comes later. */
  admin?: {
    title?: string
    logo?: string
    /** Menu order; defaults to collections, then singletons. */
    menu?: readonly string[]
    /**
     * Links on Yfirlit. `to` is a screen path under Vefstjórn, e.g. "projects/_new"; the label
     * is `admin.shortcuts.<name>` in the site's `cms` namespace.
     */
    shortcuts?: readonly { name: string; to: string }[]
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
  const { locales, defaultLocale } = config.site
  const others = locales.filter((l) => l !== defaultLocale)
  const routes = new Map<string, Set<string>>(locales.map((l) => [l, new Set()]))
  const addRoute = (name: string, locale: string, route: string) => {
    if (!route.startsWith('/')) throw new Error(`Page "${name}": route must start with /`)
    if (route !== '/' && route.endsWith('/')) {
      throw new Error(`Page "${name}": route must not end with /`)
    }
    if (locale === defaultLocale && others.includes(route.split('/')[1] ?? '')) {
      throw new Error(`Page "${name}": route "${route}" starts with a locale prefix`)
    }
    const taken = routes.get(locale)
    if (taken?.has(route)) throw new Error(`Route "${route}" (${locale}) is used by two pages`)
    taken?.add(route)
  }
  for (const [name, page] of Object.entries(config.pages ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
      throw new Error(`Page name "${name}" must be camelCase letters and digits`)
    }
    for (const locale of Object.keys(page.localeRoutes ?? {})) {
      if (!others.includes(locale)) {
        throw new Error(`Page "${name}" has a route for "${locale}", which isn't another locale`)
      }
    }
    if (page.route !== undefined) {
      addRoute(name, defaultLocale, page.route)
      for (const locale of others) {
        const route = page.localeRoutes?.[locale]
        if (route === undefined) throw new Error(`Page "${name}" has no route for "${locale}"`)
        addRoute(name, locale, route)
      }
    } else if (page.localeRoutes && Object.keys(page.localeRoutes).length > 0) {
      throw new Error(`Page "${name}" has locale routes but no route`)
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
  const known = [
    ...screens,
    ...Object.keys(config.collections),
    ...Object.keys(config.singletons ?? {}),
  ]
  for (const { name, to } of config.admin?.shortcuts ?? []) {
    if (!known.includes(to.split('/')[0] ?? '')) {
      throw new Error(`Shortcut "${name}" goes to "${to}", which isn't a Vefstjórn screen`)
    }
  }
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
