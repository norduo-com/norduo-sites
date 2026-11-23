import type { BlockConfig, Field, Fields } from './fields'
import type { RichTextInline, RichTextValue } from './richtext'

/*
 * Machine translation of a document's translatable fields (`i18n: true`). The default
 * locale is the source. Every other locale's row mirrors it: the same structure and the
 * same untranslated values, with each translatable text swapped for its translation, or
 * left in the source language until one exists (the public site then shows the source).
 *
 * Each translatable text is a *leaf*, keyed by its path (`seo.title`,
 * `blocks.0.data.heading`). A locale's row keeps one entry per leaf: a hash of the source
 * text it was translated from and its state. Only leaves whose source changed are sent to
 * the model again.
 */

/** `machine`: Óyfirfarið. `reviewed`: written or approved by a person. */
export type TranslationState = 'machine' | 'reviewed' | 'pending' | 'failed'
export interface TranslationEntry {
  /** Hash of the source text this translation belongs to. */
  src: string
  state: TranslationState
}
export type Translations = Record<string, TranslationEntry>

export type Path = (string | number)[]
export interface Leaf {
  path: Path
  /** The path joined with dots, the key in `Translations`. */
  key: string
  kind: 'text' | 'richText'
  value: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

type Nested = Field & { fields?: Fields; blocks?: Record<string, BlockConfig> }

function collect(field: Field, value: unknown, path: Path, out: Leaf[]) {
  const nested = field as Nested
  const list = Array.isArray(value) ? (value as unknown[]) : []
  switch (field.kind) {
    case 'text':
    case 'richText':
      if (field.i18n && value !== undefined)
        out.push({ path, key: path.join('.'), kind: field.kind, value })
      break
    case 'group':
    case 'seo':
      if (nested.fields && isRecord(value)) walk(nested.fields, value, path, out)
      break
    case 'repeater':
      list.forEach((item, i) => {
        if (nested.fields && isRecord(item)) walk(nested.fields, item, [...path, i], out)
      })
      break
    case 'blocks':
      list.forEach((item, i) => {
        if (!isRecord(item) || typeof item.type !== 'string' || !isRecord(item.data)) return
        const def =
          nested.blocks && Object.hasOwn(nested.blocks, item.type)
            ? nested.blocks[item.type]
            : undefined
        if (def) walk(def.fields, item.data, [...path, i, 'data'], out)
      })
      break
  }
}

function walk(fields: Fields, data: Record<string, unknown>, path: Path, out: Leaf[]) {
  for (const [name, field] of Object.entries(fields))
    collect(field, data[name], [...path, name], out)
}

/** Every translatable text of a document, in field order. */
export function translatableLeaves(fields: Fields, data: Record<string, unknown>): Leaf[] {
  const out: Leaf[] = []
  walk(fields, data, [], out)
  return out
}

export function getAt(data: unknown, path: Path): unknown {
  let node = data
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string | number, unknown>)[key]
  }
  return node
}

/** Sets a value inside `data`, whose structure must already hold the path. */
export function setAt(data: Record<string, unknown>, path: Path, value: unknown) {
  const parent = getAt(data, path.slice(0, -1))
  const last = path.at(-1)
  if (typeof parent === 'object' && parent !== null && last !== undefined)
    (parent as Record<string | number, unknown>)[last] = value
}

const inlinesOf = (value: RichTextValue) =>
  value.flatMap((b) => ('items' in b ? b.items : [b.children]))

/** Nothing to translate: blank text, or rich text without words. */
export function isBlank(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() === ''
  if (!Array.isArray(value)) return true
  return !inlinesOf(value as RichTextValue).some((list) => list.some((i) => i.text.trim()))
}

/** A short stable hash (cyrb53) of a value, to tell when its source text changed. */
export function hashValue(value: unknown): string {
  // JSON.stringify(undefined) is undefined, though typed as a string.
  const str = (JSON.stringify(value) as string | undefined) ?? ''
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// ---------- segments ----------

const isPlain = (i: RichTextInline) => !i.href && !(i.marks?.length ?? 0)
const hasWords = (list: RichTextInline[]) => list.some((i) => i.text.trim())

/**
 * One rich text block or list item as a string for the model. Formatted pieces (bold,
 * a link…) become numbered placeholders, `[1]…[/1]`, so word order may change across them;
 * links and marks never go to the model.
 */
export function encodeInlines(list: RichTextInline[]): string {
  let n = 0
  return list
    .map((i) => (isPlain(i) ? i.text : `[${String(++n)}]${i.text}[/${String(n)}]`))
    .join('')
}

/**
 * Reads a translated segment back onto the source's pieces, or null if any placeholder is
 * missing, repeated or left unclosed.
 */
export function decodeInlines(
  translated: string,
  source: RichTextInline[],
): RichTextInline[] | null {
  const formatted = source.filter((i) => !isPlain(i))
  const out: RichTextInline[] = []
  const seen = new Set<number>()
  const tag = /\[(\d+)\]([\s\S]*?)\[\/\1\]/g
  let at = 0
  const plain = (text: string) => {
    if (/\[\/?\d+\]/.test(text)) return false
    if (text) out.push({ text })
    return true
  }
  for (const m of translated.matchAll(tag)) {
    const n = Number(m[1])
    const piece = formatted[n - 1]
    if (!piece || seen.has(n) || !plain(translated.slice(at, m.index))) return null
    seen.add(n)
    const { text: _, ...format } = piece
    out.push({ ...format, text: m[2] ?? '' })
    at = m.index + m[0].length
  }
  if (!plain(translated.slice(at)) || seen.size !== formatted.length) return null
  return out.filter((i) => i.text)
}

/** The strings to translate for a leaf: the text, or each rich text block with words. */
export function segmentsOf(leaf: Leaf): string[] {
  if (leaf.kind === 'text') return typeof leaf.value === 'string' ? [leaf.value] : []
  return inlinesOf(leaf.value as RichTextValue)
    .filter(hasWords)
    .map(encodeInlines)
}

/** The leaf's value rebuilt from its translated segments, or null if one doesn't fit. */
export function fromSegments(leaf: Leaf, translated: string[]): unknown {
  if (leaf.kind === 'text') {
    const [text] = translated
    return translated.length === 1 && text?.trim() ? text.trim() : null
  }
  let i = 0
  let misfits = 0
  const next = (list: RichTextInline[]) => {
    if (!hasWords(list)) return list
    const t = translated[i++]
    const decoded = t === undefined ? null : decodeInlines(t, list)
    if (!decoded) misfits++
    return decoded ?? list
  }
  const value = (leaf.value as RichTextValue).map((b) =>
    'items' in b ? { ...b, items: b.items.map(next) } : { ...b, children: next(b.children) },
  )
  return misfits === 0 && i === translated.length ? value : null
}

// ---------- a locale's row ----------

export interface LocaleRow {
  data: Record<string, unknown>
  translations: Translations
}

const done = (e: TranslationEntry | undefined) => e?.state === 'machine' || e?.state === 'reviewed'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A locale's row after the source was saved: the source with each translatable text replaced
 * by its translation where the source text hasn't changed (or moved, e.g. a reordered block),
 * else left in the source language and marked `pending`. `todo` lists the pending keys.
 */
export function planLocale(
  fields: Fields,
  source: Record<string, unknown>,
  prev: LocaleRow | null,
): LocaleRow & { todo: string[] } {
  const data = structuredClone(source)
  const translations: Translations = {}
  const todo: string[] = []
  const old = prev?.translations ?? {}
  const oldLeaves = prev ? translatableLeaves(fields, prev.data) : []
  for (const leaf of translatableLeaves(fields, source)) {
    if (isBlank(leaf.value)) continue
    const src = hashValue(leaf.value)
    const own = old[leaf.key]
    const kept =
      own?.src === src && done(own)
        ? { entry: own, value: getAt(prev?.data, leaf.path) }
        : oldLeaves
            .filter((l) => old[l.key]?.src === src && done(old[l.key]))
            .map((l) => ({ entry: old[l.key], value: l.value }))[0]
    if (kept?.entry && kept.value !== undefined) {
      setAt(data, leaf.path, kept.value)
      translations[leaf.key] = kept.entry
    } else {
      translations[leaf.key] = { src, state: 'pending' }
      todo.push(leaf.key)
    }
  }
  return { data, translations, todo }
}

/**
 * A locale's row after an editor saved it. Only translatable texts are taken from `sent`;
 * everything else follows the source. A changed text counts as reviewed; one cleared is
 * translated again; `approve` marks machine translations as reviewed.
 */
export function editLocale(
  fields: Fields,
  source: Record<string, unknown>,
  prev: LocaleRow,
  sent: Record<string, unknown>,
  approve: readonly string[] = [],
): LocaleRow & { todo: string[] } {
  const plan = planLocale(fields, source, prev)
  for (const leaf of translatableLeaves(fields, source)) {
    if (isBlank(leaf.value)) continue
    const entry = plan.translations[leaf.key]
    if (!entry) continue
    const value = getAt(sent, leaf.path)
    const before = getAt(plan.data, leaf.path)
    if (value !== undefined && !same(value, before)) {
      if (isBlank(value)) {
        setAt(plan.data, leaf.path, leaf.value)
        plan.translations[leaf.key] = { src: entry.src, state: 'pending' }
        if (!plan.todo.includes(leaf.key)) plan.todo.push(leaf.key)
      } else {
        setAt(plan.data, leaf.path, value)
        plan.translations[leaf.key] = { src: entry.src, state: 'reviewed' }
        plan.todo = plan.todo.filter((k) => k !== leaf.key)
      }
    } else if (approve.includes(leaf.key) && entry.state === 'machine') {
      plan.translations[leaf.key] = { ...entry, state: 'reviewed' }
    }
  }
  return plan
}

/** Some translation is still a machine draft nobody has checked. */
export const needsReview = (t: Translations) => Object.values(t).some((e) => e.state === 'machine')
