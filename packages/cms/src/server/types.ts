import type { drizzle } from 'drizzle-orm/d1'

import { type CmsConfig, pageFields, PAGES_SCREEN } from '../define'
import type { Fields } from '../fields'

export type Db = ReturnType<typeof drizzle>

/** Every page is stored under this type, with the page name as its slug. */
export const PAGES_TYPE = PAGES_SCREEN

/** Names in SQL JSON paths come from the config; only plain identifiers are allowed. */
export const isIdentifier = (name: string) => /^[A-Za-z_]\w*$/.test(name)

/** Fields of one document; a page's depend on which page it is. */
export function fieldsOfDocument(
  config: CmsConfig,
  type: string,
  slug: string | null,
): Fields | undefined {
  const singletons = config.singletons ?? {}
  const pages = config.pages ?? {}
  if (Object.hasOwn(config.collections, type)) return config.collections[type]?.fields
  if (Object.hasOwn(singletons, type)) return singletons[type]?.fields
  if (type === PAGES_TYPE && slug !== null && Object.hasOwn(pages, slug))
    return pageFields(config, slug)
  return undefined
}
