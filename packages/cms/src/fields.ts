import { z } from 'zod'

/**
 * Field types the CMS knows how to edit and validate.
 * A site combines these in its `cms.config.ts`; the CMS builds forms and
 * Zod schemas from them, so it never needs to know about a site's pages.
 */

export interface FieldOptions<R extends boolean | undefined = undefined> {
  /** Label shown in Vefstjórn. */
  label?: string
  /** Help text under the field. */
  help?: string
  /** Fields are optional unless `required: true`. */
  required?: R
  /** Translatable: stored per locale, gets the "Þýða á ensku" button. */
  i18n?: boolean
}

export interface Field<K extends string = string, S extends z.ZodType = z.ZodType> {
  kind: K
  schema: S
  label?: string
  help?: string
  required: boolean
  i18n: boolean
}

export type Fields = Record<string, Field>

type MaybeOptional<S extends z.ZodType, R> = R extends true ? S : z.ZodOptional<S>

function make<K extends string, S extends z.ZodType, R extends boolean | undefined>(
  kind: K,
  schema: S,
  options: FieldOptions<R> = {},
): Field<K, MaybeOptional<S, R>> {
  const required = options.required === true
  return {
    kind,
    schema: (required ? schema : schema.optional()) as MaybeOptional<S, R>,
    label: options.label,
    help: options.help,
    required,
    i18n: options.i18n ?? false,
  }
}

/** Object schema for a set of fields. */
export type ShapeOf<F extends Fields> = { [K in keyof F]: F[K]['schema'] }
export type Infer<F extends Fields> = z.infer<z.ZodObject<ShapeOf<F>>>

export function schemaOf<F extends Fields>(fields: F): z.ZodObject<ShapeOf<F>> {
  const shape = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [name, field.schema]),
  ) as ShapeOf<F>
  return z.object(shape)
}

// ---------- field builders ----------

export const imageValue = z.object({
  mediaId: z.string().min(1),
  alt: z.string().optional(),
})
export type ImageValue = z.infer<typeof imageValue>

export function text<R extends boolean | undefined = undefined>(
  options: FieldOptions<R> & { max?: number; multiline?: boolean } = {},
) {
  const base = options.required ? z.string().trim().min(1) : z.string().trim()
  return {
    ...make('text', options.max ? base.max(options.max) : base, options),
    multiline: options.multiline ?? false,
  }
}

export function richText<R extends boolean | undefined = undefined>(options: FieldOptions<R> = {}) {
  // Stored as sanitized HTML from the editor.
  return make('richText', z.string(), options)
}

export function toggle<R extends boolean | undefined = undefined>(options: FieldOptions<R> = {}) {
  return make('toggle', z.boolean(), options)
}

export function image<R extends boolean | undefined = undefined>(options: FieldOptions<R> = {}) {
  return make('image', imageValue, options)
}

export function gallery<R extends boolean | undefined = undefined>(options: FieldOptions<R> = {}) {
  return make('gallery', z.array(imageValue), options)
}

export function select<
  const O extends readonly [string, ...string[]],
  R extends boolean | undefined = undefined,
>(choices: O, options: FieldOptions<R> = {}) {
  return { ...make('select', z.enum(choices), options), choices }
}

export function relation<R extends boolean | undefined = undefined>(
  to: string,
  options: FieldOptions<R> & { many?: false } = {},
) {
  return { ...make('relation', z.string().min(1), options), to }
}

export function repeater<F extends Fields, R extends boolean | undefined = undefined>(
  fields: F,
  options: FieldOptions<R> = {},
) {
  return { ...make('repeater', z.array(schemaOf(fields)), options), fields }
}

// ---------- blocks (page builder) ----------

export interface BlockConfig<F extends Fields = Fields> {
  label: string
  fields: F
}

export function block<F extends Fields>(label: string, fields: F): BlockConfig<F> {
  return { label, fields }
}

export type BlockValue<B extends Record<string, BlockConfig>> = {
  [K in keyof B & string]: { type: K; data: Infer<B[K]['fields']> }
}[keyof B & string]

/** An ordered list of blocks – how a page is built. */
export function blocks<
  B extends Record<string, BlockConfig>,
  R extends boolean | undefined = undefined,
>(defs: B, options: FieldOptions<R> = {}) {
  const variants = Object.entries(defs).map(([type, def]) =>
    z.object({ type: z.literal(type), data: schemaOf(def.fields) }),
  )
  const item = (variants.length === 1 ? variants[0] : z.union(variants)) as unknown as z.ZodType<
    BlockValue<B>
  >
  return { ...make('blocks', z.array(item), options), blocks: defs }
}
