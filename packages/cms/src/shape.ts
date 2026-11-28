import type { CmsConfig } from './define'
import type { Field, Fields } from './fields'

/*
 * The content shape: every place a stored document can hold a value, and its kind. Content
 * lives as JSON in D1 and site loaders trust it, so the config only ever adds to this shape.
 * A site commits its shape and a test compares it with the config (`shapeChanges`); removing
 * or retyping a field needs a one-off content script first (docs/architecture.md §2).
 *
 * Paths: `collections.projects.title`, `singletons.footer.cta.heading`,
 * `collections.services.items[].item`, `blocks.text.body`, `pages.home.blocks.text`.
 * Values: the field kind, with `?` when optional; a choice is listed as its own path.
 */

export type ContentShape = Record<string, string>

type Nested = Field & {
  choices?: readonly string[]
  fields?: Fields
  to?: string
  many?: boolean
}

function kindOf(field: Nested): string {
  const kind =
    field.kind === 'relation' ? `relation:${field.to ?? ''}${field.many ? '[]' : ''}` : field.kind
  return field.required ? kind : `${kind}?`
}

function walk(out: ContentShape, prefix: string, fields: Fields) {
  for (const [name, raw] of Object.entries(fields)) {
    const field = raw as Nested
    const path = `${prefix}.${name}`
    out[path] = kindOf(field)
    for (const choice of field.choices ?? []) out[`${path}.choices.${choice}`] = 'choice'
    // Block types are listed once under `blocks.`, not under every field that allows them.
    if (field.kind === 'blocks') continue
    if (field.fields) walk(out, field.kind === 'repeater' ? `${path}[]` : path, field.fields)
  }
}

/** The content shape of a config, with its paths sorted. */
export function contentShape(config: CmsConfig): ContentShape {
  const out: ContentShape = {}
  for (const [name, c] of Object.entries(config.collections)) {
    walk(out, `collections.${name}`, c.fields)
  }
  for (const [name, s] of Object.entries(config.singletons ?? {})) {
    walk(out, `singletons.${name}`, s.fields)
  }
  for (const [name, b] of Object.entries(config.blocks ?? {})) {
    walk(out, `blocks.${name}`, b.fields)
  }
  for (const [name, p] of Object.entries(config.pages ?? {})) {
    walk(out, `pages.${name}`, { ...p.fields, seo: p.seo })
    for (const b of p.blocks ?? []) out[`pages.${name}.blocks.${b}`] = 'block'
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/**
 * What in `next` would leave content stored under `prev` mistyped: a removed path, a changed
 * kind, or an optional field made required. Adding paths, or making a field optional, is safe.
 */
export function shapeChanges(prev: ContentShape, next: ContentShape): string[] {
  const out: string[] = []
  for (const [path, was] of Object.entries(prev)) {
    const now = next[path]
    if (now === undefined) out.push(`${path}: removed (was ${was})`)
    else if (now !== was && now !== `${was}?`) out.push(`${path}: ${was} → ${now}`)
  }
  return out
}
