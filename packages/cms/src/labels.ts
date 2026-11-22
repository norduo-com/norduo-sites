import type { CmsConfig } from './define'
import type { BlockConfig, Field, Fields } from './fields'

/**
 * Label keys in the site's `cms` translation namespace, derived from config paths:
 * `collections.<c>.label`, `collections.<c>.fields.<f>.label`, `blocks.<b>.label`, …
 * A field's label is looked up under its owner first, then site-wide under `fields.<f>`,
 * so shared labels (heading, lead) are written once.
 */

export const collectionLabelKey = (name: string) => `collections.${name}.label`
export const singletonLabelKey = (name: string) => `singletons.${name}.label`
export const blockLabelKey = (name: string) => `blocks.${name}.label`
export const pageLabelKey = (name: string) => `pages.${name}.label`

/** Candidate keys for a field's label, most specific first. `owner` is e.g. "collections.team". */
export function fieldLabelKeys(owner: string, field: string): string[] {
  return [`${owner}.fields.${field}.label`, `fields.${field}.label`]
}

export function fieldHelpKeys(owner: string, field: string): string[] {
  return [`${owner}.fields.${field}.help`, `fields.${field}.help`]
}

export function choiceLabelKeys(owner: string, field: string, choice: string): string[] {
  return [`${owner}.fields.${field}.choices.${choice}`, `fields.${field}.choices.${choice}`]
}

/** A rich text field's site mark: under the field first, then site-wide `marks.<m>`. */
export function markLabelKeys(owner: string, field: string, mark: string): string[] {
  return [`${owner}.fields.${field}.marks.${mark}`, `marks.${mark}`]
}

type Nested = Field & {
  choices?: readonly string[]
  marks?: Record<string, string>
  fields?: Fields
  blocks?: Record<string, BlockConfig>
}

/** Every label the config needs, each as its candidate keys (most specific first). */
export function requiredLabels(config: CmsConfig): string[][] {
  const out: string[][] = []

  const walkBlock = (name: string, def: BlockConfig) => {
    out.push([blockLabelKey(name)])
    walkFields(`blocks.${name}`, def.fields)
  }

  const walkFields = (owner: string, fields: Fields) => {
    for (const [name, raw] of Object.entries(fields)) {
      const field = raw as Nested
      // `seo()` and its sub-fields are generic, labelled in the `vefstjorn` namespace.
      if (field.kind === 'seo') continue
      out.push(fieldLabelKeys(owner, name))
      for (const choice of field.choices ?? []) out.push(choiceLabelKeys(owner, name, choice))
      for (const mark of Object.keys(field.marks ?? {})) out.push(markLabelKeys(owner, name, mark))
      if (field.fields) walkFields(`${owner}.fields.${name}`, field.fields)
      for (const [b, def] of Object.entries(field.blocks ?? {})) walkBlock(b, def)
    }
  }

  for (const [name, c] of Object.entries(config.collections)) {
    out.push([collectionLabelKey(name)])
    walkFields(`collections.${name}`, c.fields)
  }
  for (const [name, s] of Object.entries(config.singletons ?? {})) {
    out.push([singletonLabelKey(name)])
    walkFields(`singletons.${name}`, s.fields)
  }
  for (const [name, def] of Object.entries(config.blocks ?? {})) walkBlock(name, def)
  for (const [name, p] of Object.entries(config.pages ?? {})) {
    out.push([pageLabelKey(name)])
    walkFields(`pages.${name}`, p.fields)
  }

  // A block used by several fields is listed once.
  const seen = new Set<string>()
  return out.filter((keys) => {
    const id = keys.join('|')
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function has(resources: object, key: string): boolean {
  let node: unknown = resources
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' && node.length > 0
}

/** Labels with no translation in `resources` (one locale of the `cms` namespace). */
export function missingLabels(config: CmsConfig, resources: object): string[] {
  return requiredLabels(config)
    .filter((keys) => !keys.some((k) => has(resources, k)))
    .map((keys) => keys[0] ?? '')
}
