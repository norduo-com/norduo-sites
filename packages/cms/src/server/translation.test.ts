import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { defineCms } from '../define'
import { richText, text } from '../fields'
import { testDatabase } from '../test/d1'
import {
  type AdminDocument,
  contentVersion,
  createCmsApi,
  listPublished,
  retryTranslations,
  TranslationError,
  type Translator,
  workersAiTranslator,
} from './index'
import { translationPrompt } from './translate'

const cms = defineCms({
  site: {
    id: 'test',
    name: 'Test',
    url: 'https://example.com',
    locales: ['is', 'en'],
    defaultLocale: 'is',
  },
  collections: {
    equipment: {
      fields: {
        name: text({ required: true, i18n: true }),
        description: richText({ i18n: true }),
        code: text(),
      },
    },
  },
  translation: { about: 'a landscaping company', glossary: { kranabíll: 'crane truck' } },
})

let db: Awaited<ReturnType<typeof testDatabase>>
beforeAll(async () => {
  db = await testDatabase()
})
afterAll(async () => {
  await db.dispose()
})
beforeEach(async () => {
  await db.reset()
})

/** A translator that answers from a dictionary, and records every call. */
function dictionary(words: Record<string, string>) {
  const calls: { segments: string[]; attempt: number }[] = []
  const translate: Translator = ({ segments, attempt }) => {
    calls.push({ segments, attempt })
    return Promise.resolve(segments.map((s) => words[s] ?? `EN ${s}`))
  }
  return { calls, translate }
}

function setup(translate: Translator) {
  const app = createCmsApi(cms, { translator: translate })
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => undefined,
    props: {},
  }
  const env = { DB: db.d1, MEDIA: db.r2, ENVIRONMENT: 'development' }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      `/admin/content/equipment${path}`,
      {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      },
      env,
      ctx,
    )
    // Wait for the translation the save started in the background.
    await Promise.all(pending.splice(0))
    return res
  }
  return {
    env,
    create: async (data: Record<string, unknown>) =>
      (await (await call('POST', '', { data })).json<{ slug: string }>()).slug,
    save: (slug: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      call('PUT', `/${slug}`, { data, ...extra }),
    english: async (slug: string) =>
      (await call('GET', `/${slug}?locale=en`)).json<AdminDocument>(),
  }
}

const needsReview = async () =>
  (
    await db.d1.prepare("select needs_review from documents where locale = 'en'").first<{
      needs_review: number
    }>()
  )?.needs_review

describe('machine translation on save', () => {
  it('fills the English row after an Icelandic save and flags it Óyfirfarið', async () => {
    const t = setup(dictionary({ Kranabíll: 'Crane truck' }).translate)
    const slug = await t.create({ name: 'Kranabíll', code: 'K1' })
    const en = await t.english(slug)
    expect(en.data).toEqual({ name: 'Crane truck', code: 'K1' })
    expect(en.translations?.name?.state).toBe('machine')
    expect(await needsReview()).toBe(1)
    const published = await listPublished(db.d1, cms, 'equipment', {
      fields: ['name'],
      locale: 'en',
    })
    expect(published.map((p) => p.data.name)).toEqual(['Crane truck'])
  })

  it('clears Óyfirfarið when the English is edited, and keeps it on later Icelandic saves', async () => {
    const d = dictionary({})
    const t = setup(d.translate)
    const slug = await t.create({ name: 'Kranabíll' })
    await t.save(slug, { name: 'Our crane truck' }, { locale: 'en' })
    expect((await t.english(slug)).translations?.name?.state).toBe('reviewed')
    expect(await needsReview()).toBe(0)

    await t.save(slug, { name: 'Kranabíll', code: 'K2' })
    expect((await t.english(slug)).data).toEqual({ name: 'Our crane truck', code: 'K2' })
    expect(d.calls).toHaveLength(1)
  })

  it('approves a machine translation without changing it', async () => {
    const t = setup(dictionary({}).translate)
    const slug = await t.create({ name: 'Kranabíll' })
    const en = await t.english(slug)
    await t.save(slug, en.data, { locale: 'en', approve: ['name'] })
    expect((await t.english(slug)).translations?.name?.state).toBe('reviewed')
  })

  it('translates only texts whose Icelandic changed', async () => {
    const d = dictionary({})
    const t = setup(d.translate)
    const slug = await t.create({ name: 'Kranabíll', code: 'K1' })
    await t.save(slug, { name: 'Kranabíll', code: 'K2' })
    await t.save(slug, { name: 'Vörubíll', code: 'K2' })
    expect(d.calls.map((c) => c.segments)).toEqual([['Kranabíll'], ['Vörubíll']])
    expect((await t.english(slug)).data.name).toBe('EN Vörubíll')
  })

  it('sends rich text as placeholder segments and keeps links out of the request', async () => {
    const d = dictionary({ 'Sjá [1]verð[/1].': 'See [1]prices[/1].' })
    const t = setup(d.translate)
    const description = [
      {
        type: 'p',
        children: [{ text: 'Sjá ' }, { text: 'verð', href: 'https://a.is' }, { text: '.' }],
      },
    ]
    const slug = await t.create({ name: 'Krani', description })
    expect(JSON.stringify(d.calls)).not.toContain('https://a.is')
    expect((await t.english(slug)).data.description).toEqual([
      {
        type: 'p',
        children: [{ text: 'See ' }, { text: 'prices', href: 'https://a.is' }, { text: '.' }],
      },
    ])
  })

  it('tries the fallback model when the reply breaks a placeholder, then marks it failed', async () => {
    const attempts: number[] = []
    const broken: Translator = ({ segments, attempt }) => {
      attempts.push(attempt)
      return Promise.resolve(segments.map(() => 'No placeholders'))
    }
    const t = setup(broken)
    const description = [{ type: 'p', children: [{ text: 'feitt', marks: ['bold'] }] }]
    const slug = await t.create({ name: 'Krani', description })
    const en = await t.english(slug)
    expect(attempts).toEqual([0, 1])
    expect(en.translations?.description?.state).toBe('failed')
    // The Icelandic stays in place, so the public English page shows it.
    expect(en.data.description).toEqual(description)
    expect(en.data.name).toBe('No placeholders')
  })

  it('leaves texts pending when the day’s allowance is used up; the nightly retry fills them', async () => {
    const quota: Translator = () => Promise.reject(new TranslationError('quota', '3036'))
    const t = setup(quota)
    const slug = await t.create({ name: 'Kranabíll' })
    expect((await t.english(slug)).translations?.name?.state).toBe('pending')
    expect((await t.english(slug)).data.name).toBe('Kranabíll')

    const before = await contentVersion(db.d1)
    await retryTranslations(cms, t.env, { translator: dictionary({}).translate })
    const en = await t.english(slug)
    expect(en.data.name).toBe('EN Kranabíll')
    expect(en.translations?.name?.state).toBe('machine')
    expect(await contentVersion(db.d1)).toBe(before + 1)
  })

  it('never fails a save when translation throws', async () => {
    const t = setup(() => Promise.reject(new Error('boom')))
    const slug = await t.create({ name: 'Kranabíll' })
    expect((await t.english(slug)).translations?.name?.state).toBe('pending')
  })
})

describe('workersAiTranslator', () => {
  const ai = (reply: unknown, seen: unknown[] = []) =>
    ({
      run: (model: string, input: unknown) => {
        seen.push({ model, input })
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)
      },
    }) as unknown as Ai

  it('asks Gemma with thinking off, then Qwen as the fallback', async () => {
    const seen: { model: string; input: Record<string, unknown> }[] = []
    const reply = { choices: [{ message: { content: '{"segments":["Crane truck"]}' } }] }
    const translate = workersAiTranslator(ai(reply, seen))
    const request = { segments: ['Kranabíll'], from: 'is', to: 'en' }
    expect(await translate({ ...request, attempt: 0 })).toEqual(['Crane truck'])
    await translate({ ...request, attempt: 1 })
    expect(seen.map((s) => s.model)).toEqual([
      '@cf/google/gemma-4-26b-a4b-it',
      '@cf/qwen/qwen3.8-27b',
    ])
    expect(seen[0]?.input.chat_template_kwargs).toEqual({ enable_thinking: false })
  })

  it('tells a used-up allowance (3036) from a busy model (3040)', async () => {
    const request = { segments: ['a'], from: 'is', to: 'en', attempt: 0 }
    await expect(
      workersAiTranslator(ai(new Error('3036: daily free allocation exceeded')))(request),
    ).rejects.toMatchObject({ reason: 'quota' })
    await expect(
      workersAiTranslator(ai(new Error('AiError: 3040: Capacity temporarily exceeded')))(request),
    ).rejects.toMatchObject({ reason: 'busy' })
  })

  it('puts the site’s description and glossary in the prompt', () => {
    const prompt = translationPrompt(cms.translation, 'is', 'en')
    expect(prompt).toContain('for a landscaping company from Icelandic to English')
    expect(prompt).toContain('kranabíll = crane truck')
  })
})
