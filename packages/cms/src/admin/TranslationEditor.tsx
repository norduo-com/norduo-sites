import { type SyntheticEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Field, Fields } from '../fields'
import { fieldLabelKeys } from '../labels'
import type { AdminDocument } from '../server'
import type { Translations, TranslationState } from '../translate'
import { type AdminApi, ApiError } from './api'
import { useAdmin } from './context'
import { Editor, type EditorDoc } from './Editor'
import { FieldInput } from './inputs'

type Nested = Field & { fields?: Fields }

/** Has a translatable text somewhere inside. */
function translatable(field: Field): boolean {
  if (field.kind === 'text' || field.kind === 'richText') return field.i18n
  const nested = field as Nested & { blocks?: Record<string, { fields: Fields }> }
  if (nested.fields) return Object.values(nested.fields).some(translatable)
  if (nested.blocks)
    return Object.values(nested.blocks).some((b) => Object.values(b.fields).some(translatable))
  return false
}

/**
 * The fields a translation shows: translatable ones, groups and repeaters cut down to their
 * translatable parts.
 */
export function translatableFields(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([name, field]) => {
      if (!translatable(field)) return []
      const nested = field as Nested
      if ((field.kind === 'group' || field.kind === 'repeater') && nested.fields)
        return [[name, { ...field, fields: translatableFields(nested.fields) }]]
      return [[name, field]]
    }),
  )
}

/** States of the texts under one top-level field, most urgent first. */
const ORDER: TranslationState[] = ['machine', 'failed', 'pending', 'reviewed']
function stateOf(translations: Translations, name: string) {
  const states = Object.entries(translations)
    .filter(([key]) => key === name || key.startsWith(`${name}.`))
    .map(([, e]) => e.state)
  return ORDER.find((s) => states.includes(s))
}
const machineKeys = (translations: Translations, name: string) =>
  Object.entries(translations)
    .filter(([key, e]) => (key === name || key.startsWith(`${name}.`)) && e.state === 'machine')
    .map(([key]) => key)

/** For a locale without a `locales.<code>` label: its name in Icelandic, as the admin is. */
const languageName = (locale: string, display: string) => {
  const name = new Intl.DisplayNames([display], { type: 'language' }).of(locale) ?? locale
  return name.charAt(0).toUpperCase() + name.slice(1)
}

interface EditorProps {
  api: AdminApi
  type: string
  owner: string
  fields: Fields
  drafts: boolean
  doc: EditorDoc
  previewPath?: string
  onSaved: (doc: EditorDoc & { slug: string }) => void
  onDeleted?: () => void
}

/**
 * The document editor with a language switch when the site has more than one locale and the
 * document has translatable fields. The default locale is edited in full; another locale only
 * in its translatable texts, which are machine translated after each save of the default one.
 */
export function LocalizedEditor(props: EditorProps) {
  const { config } = useAdmin()
  const { t } = useTranslation('vefstjorn')
  const { defaultLocale, locales } = config.site
  const others = locales.filter((l) => l !== defaultLocale)
  const shown = translatableFields(props.fields)
  const [locale, setLocale] = useState(defaultLocale)
  // A fresh translation editor each time it opens, so it shows the latest machine draft.
  const [opened, setOpened] = useState(0)
  const tabsId = useId()

  if (others.length === 0 || Object.keys(shown).length === 0) return <Editor {...props} />
  const slug = props.doc.slug
  const tab = (l: string) => (
    <button
      key={l}
      type="button"
      role="tab"
      id={`${tabsId}-${l}`}
      aria-selected={locale === l}
      aria-controls={`${tabsId}-${l}-panel`}
      disabled={l !== defaultLocale && slug === null}
      onClick={() => {
        setLocale(l)
        setOpened((n) => n + 1)
      }}
      className="rounded-lg px-3 py-1.5 aria-selected:bg-neutral-900 aria-selected:text-white disabled:opacity-50"
    >
      {t(`locales.${l}`, { defaultValue: languageName(l, 'is') })}
    </button>
  )

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-wrap items-center">
        <div role="tablist" aria-label={t('translation.language')} className="gap-1 flex">
          {[defaultLocale, ...others].map(tab)}
        </div>
        <p className="text-sm text-neutral-500">{t('translation.auto')}</p>
      </div>
      {/* The default locale's editor stays mounted, so its unsaved edits survive a switch. */}
      <div
        role="tabpanel"
        id={`${tabsId}-${defaultLocale}-panel`}
        aria-labelledby={`${tabsId}-${defaultLocale}`}
        hidden={locale !== defaultLocale}
      >
        <Editor {...props} />
      </div>
      {locale !== defaultLocale && slug !== null && (
        <div
          role="tabpanel"
          id={`${tabsId}-${locale}-panel`}
          aria-labelledby={`${tabsId}-${locale}`}
        >
          <TranslationEditor
            key={opened}
            api={props.api}
            type={props.type}
            slug={slug}
            locale={locale}
            owner={props.owner}
            fields={shown}
            previewPath={props.previewPath}
          />
        </div>
      )}
    </div>
  )
}

/** One locale's translatable texts, each flagged Óyfirfarið until edited or approved. */
function TranslationEditor({
  api,
  type,
  slug,
  locale,
  owner,
  fields,
  previewPath,
}: {
  api: AdminApi
  type: string
  slug: string
  locale: string
  owner: string
  fields: Fields
  previewPath?: string
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const formId = useId()
  const [doc, setDoc] = useState<AdminDocument | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [touched, setTouched] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    api.get(type, slug, locale).then(
      (d) => {
        setDoc(d)
        setValues(d.data)
        setTouched([])
      },
      (err: unknown) => {
        setLoadError(
          err instanceof ApiError && err.status === 404
            ? 'translation.saveSourceFirst'
            : 'errors.loadFailed',
        )
      },
    )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per opening
  }, [])

  const failure = (err: unknown) =>
    err instanceof ApiError && err.status === 401
      ? t('errors.unauthorized')
      : t('errors.saveFailed')

  async function send(approve: string[] = []) {
    if (!doc) return
    setMessage(null)
    setBusy(true)
    try {
      // Approving alone sends the stored texts, so unsaved edits elsewhere aren't saved by it.
      const data = approve.length ? doc.data : values
      await api.update(type, slug, { status: doc.status, locale, data, approve })
      const fresh = await api.get(type, slug, locale)
      setDoc(fresh)
      if (approve.length === 0) {
        setValues(fresh.data)
        setTouched([])
      }
      setMessage({ tone: 'ok', text: t(approve.length ? 'translation.approved' : 'editor.saved') })
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err) })
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p role="alert">{t(loadError)}</p>
  if (!doc) return <p>{t('list.loading')}</p>
  const translations = doc.translations ?? {}

  const submit = (e: SyntheticEvent) => {
    e.preventDefault()
    void send()
  }

  return (
    <form onSubmit={submit} noValidate className="gap-5 flex flex-col">
      <p className="text-sm text-neutral-600">{t('translation.help')}</p>
      {Object.entries(fields).map(([name, field]) => {
        const state = touched.includes(name) ? undefined : stateOf(translations, name)
        const machine = machineKeys(translations, name)
        return (
          <div key={name} className="gap-2 flex flex-col">
            {state && state !== 'reviewed' && (
              <div className="gap-2 flex flex-wrap items-center">
                <span
                  className={
                    state === 'machine'
                      ? 'bg-amber-100 px-2 text-sm text-amber-900 rounded-full'
                      : 'bg-neutral-200 px-2 text-sm text-neutral-700 rounded-full'
                  }
                >
                  {t(`translation.state.${state}`)}
                </span>
                {state === 'machine' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send(machine)}
                    className="text-sm text-neutral-700 underline"
                    aria-label={t('translation.approveField', {
                      field: t(fieldLabelKeys(owner, name), { ns: 'cms' }),
                    })}
                  >
                    {t('translation.approve')}
                  </button>
                )}
              </div>
            )}
            <FieldInput
              owner={owner}
              name={name}
              field={field}
              path={name}
              idPrefix={formId}
              value={values[name]}
              doc={values}
              previewPath={previewPath}
              translating
              errors={{}}
              onChange={(value) => {
                setValues((v) => ({ ...v, [name]: value }))
                setTouched((list) => (list.includes(name) ? list : [...list, name]))
              }}
            />
          </div>
        )
      })}
      <div className="gap-3 flex flex-wrap items-center">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {busy ? t('actions.saving') : t('actions.save')}
        </button>
        <p role="status" className={message?.tone === 'error' ? 'text-red-700' : 'text-green-800'}>
          {message?.text}
        </p>
      </div>
    </form>
  )
}
