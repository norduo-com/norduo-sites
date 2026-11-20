import type { BlockConfig, Fields, Infer } from './fields'

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
}

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
}

/** Identity helper that keeps the literal types of the config. */
export function defineCms<const C extends CmsConfig>(config: C): C {
  for (const name of Object.keys(config.collections)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`Collection name "${name}" must be lowercase letters, digits and dashes`)
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
