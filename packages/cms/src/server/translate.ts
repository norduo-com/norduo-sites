import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

import { documents, siteMeta } from '../db/schema'
import type { CmsConfig } from '../define'
import type { Fields } from '../fields'
import {
  fromSegments,
  hashValue,
  needsReview,
  segmentsOf,
  setAt,
  translatableLeaves,
  type Translations,
} from '../translate'

/*
 * Machine translation runs after the save is in D1 (in `waitUntil`, or the nightly cron),
 * so a save never waits on or fails because of it.
 */

/** Gemma is the main model; Qwen is tried when Gemma is busy or its reply doesn't fit. */
export const TRANSLATION_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3.8-27b'] as const

/** Why a translation call failed. `quota`: the day's free neurons are used up (until 00:00 UTC). */
export class TranslationError extends Error {
  constructor(
    readonly reason: 'quota' | 'busy' | 'other',
    message: string,
  ) {
    super(message)
  }
}

export interface TranslateRequest {
  segments: string[]
  from: string
  to: string
  /** 0 for the main model, 1 for the fallback. */
  attempt: number
}

/** Translates segments in order; the reply must have one string per segment. */
export type Translator = (request: TranslateRequest) => Promise<string[]>

/** What the site tells the model about itself, from `cms.config.ts`. */
export type TranslationContext = NonNullable<CmsConfig['translation']>

const languageName = (code: string) =>
  new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code

export function translationPrompt(context: TranslationContext, from: string, to: string) {
  const glossary = Object.entries(context.glossary ?? {})
  return [
    `You translate website copy${context.about ? ` for ${context.about}` : ''} from ${languageName(from)} to ${languageName(to)}.`,
    'Rules:',
    '- Translate only. Never add, drop or explain anything.',
    '- Natural, plain language suitable for a company website. Keep the tone.',
    '- Keep names of people, companies and places as they are.',
    '- Placeholders like [1]…[/1] mark formatted text: keep every one exactly once, around the matching words.',
    ...(glossary.length ? [`- Terms: ${glossary.map(([a, b]) => `${a} = ${b}`).join(', ')}.`] : []),
    '- Reply with JSON only: {"segments": [...]}, one string per input string, in the same order.',
  ].join('\n')
}

const replySchema = {
  type: 'object',
  properties: { segments: { type: 'array', items: { type: 'string' } } },
  required: ['segments'],
}

/** Workers AI error codes: 3036 daily allowance used up, 3040 out of capacity for now. */
function classify(err: unknown): TranslationError {
  const message = err instanceof Error ? err.message : String(err)
  if (/\b3036\b/.test(message)) return new TranslationError('quota', message)
  if (/\b3040\b/.test(message)) return new TranslationError('busy', message)
  return new TranslationError('other', message)
}

function segmentsFrom(reply: unknown): string[] {
  const choice = (reply as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]
  const content = choice?.message?.content ?? (reply as { response?: unknown }).response
  const parsed: unknown = typeof content === 'string' ? JSON.parse(content) : content
  const segments = (parsed as { segments?: unknown } | null)?.segments
  if (!Array.isArray(segments) || !segments.every((s) => typeof s === 'string'))
    throw new TranslationError('other', 'Reply has no segments')
  return segments
}

/** Translation through the Workers AI binding, thinking turned off. */
export function workersAiTranslator(ai: Ai, context: TranslationContext = {}): Translator {
  return async ({ segments, from, to, attempt }) => {
    const model = attempt === 0 ? TRANSLATION_MODELS[0] : TRANSLATION_MODELS[1]
    let reply: unknown
    try {
      reply = await (ai.run as (model: string, input: unknown) => Promise<unknown>)(model, {
        messages: [
          { role: 'system', content: translationPrompt(context, from, to) },
          { role: 'user', content: JSON.stringify({ segments }) },
        ],
        // Icelandic tokenises long; English is shorter, so this leaves plenty of room.
        max_tokens: Math.min(8000, 500 + JSON.stringify(segments).length),
        temperature: 0.2,
        response_format: { type: 'json_schema', json_schema: replySchema },
        chat_template_kwargs: { enable_thinking: false },
      })
    } catch (err) {
      throw classify(err)
    }
    return segmentsFrom(reply)
  }
}

/** For local development and tests: "[en] " before each segment. */
export const fakeTranslator: Translator = ({ segments, to }) =>
  Promise.resolve(segments.map((s) => `[${to}] ${s}`))

type Db = ReturnType<typeof drizzle>

/**
 * Translates the pending texts of one document into one locale and writes them, unless the
 * row changed meanwhile (then the next save or the cron picks them up). Never throws.
 * Returns false when the day's allowance is used up, so a caller can stop.
 */
export async function translateDocument(
  d1: D1Database,
  translate: Translator,
  doc: { type: string; slug: string; fields: Fields; from: string; to: string },
  options: { retryFailed?: boolean } = {},
): Promise<boolean> {
  const db = drizzle(d1)
  const row = (locale: string) =>
    db
      .select({
        data: documents.data,
        translations: documents.translations,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.type, doc.type),
          eq(documents.slug, doc.slug),
          eq(documents.locale, locale),
        ),
      )
      .get()
  try {
    const [source, target] = await Promise.all([row(doc.from), row(doc.to)])
    if (!source || !target) return true
    const translations: Translations = { ...(target.translations ?? {}) }
    const wanted = (state: string) =>
      state === 'pending' || (options.retryFailed && state === 'failed')
    const leaves = translatableLeaves(doc.fields, source.data).filter((l) => {
      const entry = translations[l.key]
      return entry && wanted(entry.state) && entry.src === hashValue(l.value)
    })
    if (leaves.length === 0) return true

    const results = new Map<string, unknown>()
    let left = leaves
    let quota = false
    let replied = false
    for (let attempt = 0; attempt < 2 && left.length > 0; attempt++) {
      const segments = left.flatMap(segmentsOf)
      let reply: string[]
      try {
        reply = await translate({ segments, from: doc.from, to: doc.to, attempt })
      } catch (err) {
        const reason = err instanceof TranslationError ? err.reason : 'other'
        console.warn('translation failed', { ...doc, fields: undefined, attempt, reason })
        if (reason === 'quota') {
          quota = true
          break
        }
        continue
      }
      replied = true
      if (reply.length !== segments.length) reply = []
      let at = 0
      for (const leaf of left) {
        const count = segmentsOf(leaf).length
        const value = reply.length ? fromSegments(leaf, reply.slice(at, at + count)) : null
        at += count
        if (value !== null) results.set(leaf.key, value)
      }
      left = left.filter((l) => !results.has(l.key))
    }
    // A reply that never fit is marked failed; a call that never went through stays pending.
    if (results.size === 0 && !replied) return !quota
    const data = structuredClone(target.data)
    for (const leaf of leaves) {
      const entry = translations[leaf.key]
      if (!entry) continue
      if (results.has(leaf.key)) {
        setAt(data, leaf.path, results.get(leaf.key))
        translations[leaf.key] = { ...entry, state: 'machine' }
      } else if (replied) {
        translations[leaf.key] = { ...entry, state: 'failed' }
      }
    }

    await db.batch([
      db
        .update(documents)
        .set({ data, translations, needsReview: needsReview(translations), updatedAt: new Date() })
        .where(
          and(
            eq(documents.type, doc.type),
            eq(documents.slug, doc.slug),
            eq(documents.locale, doc.to),
            eq(documents.updatedAt, target.updatedAt),
          ),
        ),
      bumpContentVersion(db),
    ])
    return !quota
  } catch (err) {
    console.warn('translation failed', { type: doc.type, slug: doc.slug, error: String(err) })
    return true
  }
}

export function bumpContentVersion(db: Db) {
  return db
    .insert(siteMeta)
    .values({ key: 'content_version', value: 1 })
    .onConflictDoUpdate({ target: siteMeta.key, set: { value: sql`${siteMeta.value} + 1` } })
}

/**
 * Nightly: retries every pending translation, e.g. those left when the day's allowance ran
 * out. Stops at the first `quota` error. `fieldsOf` finds a document's fields.
 */
export async function retryPendingTranslations(
  d1: D1Database,
  config: CmsConfig,
  translate: Translator,
  fieldsOf: (type: string, slug: string) => Fields | undefined,
): Promise<void> {
  const { results } = await d1
    .prepare(
      `select type, slug, locale from documents
       where locale <> ? and instr(translations, '"pending"') > 0`,
    )
    .bind(config.site.defaultLocale)
    .all<{ type: string; slug: string; locale: string }>()
  for (const r of results) {
    const fields = fieldsOf(r.type, r.slug)
    if (!fields) continue
    const more = await translateDocument(d1, translate, {
      type: r.type,
      slug: r.slug,
      fields,
      from: config.site.defaultLocale,
      to: r.locale,
    })
    if (!more) return
  }
}
