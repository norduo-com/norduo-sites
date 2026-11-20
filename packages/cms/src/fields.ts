import { z } from 'zod'

import { richTextSchema } from './richtext'

/**
 * Field types the CMS knows how to edit and validate.
 * A site combines these in its `cms.config.ts`; the CMS builds forms and
 * Zod schemas from them, so it never needs to know about a site's pages.
 */

/** Labels and help text come from the site's `cms` translations, not from here. */
export interface FieldOptions<R extends boolean | undefined = undefined> {
  /** Fields are optional unless `required: true`. */
  required?: R
  /** Translatable: stored per locale, gets the "Þýða á ensku" button. */
  i18n?: boolean
}

export interface Field<K extends string = string, S extends z.ZodType = z.ZodType> {
  kind: K
  schema: S
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

const isDistinct = (list: readonly unknown[]) => new Set(list).size === list.length

/** For values that are never translated (addresses, numbers, links): no `i18n` option. */
export type PlainOptions<R extends boolean | undefined = undefined> = Omit<FieldOptions<R>, 'i18n'>

export function email<R extends boolean | undefined = undefined>(options: PlainOptions<R> = {}) {
  return make('email', z.email(), options)
}

/** A web link; only http(s), so a stored value is always safe to put in an `href`. */
export function url<R extends boolean | undefined = undefined>(options: PlainOptions<R> = {}) {
  return make('url', z.url({ protocol: /^https?$/, hostname: z.regexes.domain }), options)
}

export function year<R extends boolean | undefined = undefined>(options: PlainOptions<R> = {}) {
  return make('year', z.number().int().min(1900).max(2100), options)
}

const month = z.number().int().min(1).max(12)
export const monthRangeValue = z.object({ from: month, to: month })
export type MonthRangeValue = z.infer<typeof monthRangeValue>

/**
 * A span of months without a year, e.g. May to August. It may run over new year
 * (November to February). Month names come from the site's own translations.
 */
export function monthRange<R extends boolean | undefined = undefined>(
  options: PlainOptions<R> = {},
) {
  return make('monthRange', monthRangeValue, options)
}

/** A phone number: digits with optional +, spaces, dashes and brackets; at least 3 digits. */
export function tel<R extends boolean | undefined = undefined>(options: PlainOptions<R> = {}) {
  const schema = z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]+$/)
    .refine((v) => v.replace(/\D/g, '').length >= 3)
  return make('tel', schema, options)
}

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
    max: options.max,
  }
}

/**
 * Formatted text: paragraphs, headings and lists with bold, italic and links. `marks` adds
 * the site's own marks, name → class names, e.g. `{ muted: 'text-muted' }`; each mark's
 * label is `marks.<name>` in the site's `cms` translations. Stored as a tree (`richtext.ts`).
 */
export function richText<
  R extends boolean | undefined = undefined,
  const M extends Record<string, string> = Record<string, string>,
>(options: FieldOptions<R> & { marks?: M } = {}) {
  const marks = options.marks ?? ({} as M)
  const schema = richTextSchema(Object.keys(marks), options.required === true)
  return { ...make('richText', schema, options), marks }
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

/** Several of a fixed set of choices. A `min` above 0 makes the field required. */
export function multiSelect<
  const O extends readonly [string, ...string[]],
  R extends boolean | undefined = undefined,
  M extends number = 0,
>(choices: O, options: PlainOptions<R> & { min?: M } = {}) {
  const min = options.min ?? 0
  const schema = z
    .array(z.enum(choices))
    .min(min)
    .refine(isDistinct, { message: 'Duplicate choice' })
  const required = (min > 0 || options.required === true) as M extends 0 ? R : true
  return { ...make('multiSelect', schema, { required }), choices, min }
}

const distinctIds = z.array(z.string().min(1)).refine(isDistinct, { message: 'Duplicate item' })

/** A link to one item in another collection, or to several with `many: true`. Stores ids. */
export function relation<R extends boolean | undefined = undefined>(
  to: string,
  options?: PlainOptions<R> & { many?: false },
): Field<'relation', MaybeOptional<z.ZodString, R>> & { to: string; many: false }
export function relation<R extends boolean | undefined = undefined>(
  to: string,
  options: PlainOptions<R> & { many: true },
): Field<'relation', MaybeOptional<typeof distinctIds, R>> & { to: string; many: true }
export function relation(to: string, options: PlainOptions<boolean> & { many?: boolean } = {}) {
  const many = options.many === true
  return { ...make('relation', many ? distinctIds : z.string().min(1), options), to, many }
}

export function repeater<F extends Fields, R extends boolean | undefined = undefined>(
  fields: F,
  options: FieldOptions<R> = {},
) {
  return { ...make('repeater', z.array(schemaOf(fields)), options), fields }
}

export const slugValue = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/**
 * The document's address on the site, e.g. `/<page>/<slug>`. Vefstjórn makes it from the
 * `from` field while the document is a draft and locks it on first publish. Editors can't
 * type it. Only top-level fields of a collection get a slug.
 */
export function slug<const From extends string>(options: { from: From }) {
  return { ...make('slug', slugValue), from: options.from }
}

/** Fields kept together as one value, e.g. a call to action's heading and button. */
export function group<F extends Fields, R extends boolean | undefined = undefined>(
  fields: F,
  options: PlainOptions<R> = {},
) {
  return { ...make('group', schemaOf(fields), options), fields }
}

// ---------- blocks (page builder) ----------

export interface BlockConfig<F extends Fields = Fields> {
  fields: F
}

export function block<F extends Fields>(fields: F): BlockConfig<F> {
  return { fields }
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
