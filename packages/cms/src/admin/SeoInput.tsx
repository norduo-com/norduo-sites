import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, type SeoField, seoMeta } from '../seo'
import { useAdmin } from './context'
import { ImageInput } from './ImageInput'
import type { FieldErrors } from './inputs'
import { inputClass } from './styles'

type Part = 'keyword' | 'title' | 'description' | 'image'

/**
 * A top-level `seo()` field: keyword, title, description and share image, with a Google
 * preview built by the same `seoMeta` as the site's `<head>`, so the two always agree.
 * Empty title and description show their fallbacks as placeholders.
 */
export function SeoInput({
  field,
  name,
  idPrefix,
  value,
  doc,
  previewPath,
  errors,
  onChange,
}: {
  field: SeoField
  /** The field's name in the document; `seo()` is only used at the top level. */
  name: string
  idPrefix: string
  value: unknown
  /** The whole document, for the fallbacks. */
  doc: Record<string, unknown>
  /** Path of the document on the site, e.g. "/thjonusta"; shown in the preview. */
  previewPath?: string
  errors: FieldErrors
  onChange: (value: unknown) => void
}) {
  const { t } = useTranslation('vefstjorn')
  const { config } = useAdmin()
  const own = (value ?? {}) as Record<string, unknown>
  const options = { name, siteName: config.site.name }
  const meta = seoMeta(field, doc, options)
  const fallback = seoMeta(field, { ...doc, [name]: undefined }, options)
  const str = (k: Part) => (typeof own[k] === 'string' ? own[k] : '')

  const set = (key: Part, v: unknown) => {
    const next = { ...own, [key]: typeof v === 'string' && v.trim() === '' ? undefined : v }
    // Nothing filled in: leave the field out, so an optional seo() stays valid.
    onChange(Object.values(next).every((x) => x === undefined) ? undefined : next)
  }

  const id = (k: Part) => `${idPrefix}-${name}.${k}`
  const errorOf = (k: Part) => errors[`${name}.${k}`]
  /** Props for a part's input: its id, invalid state and the notes that describe it. */
  const describe = (k: Part) => {
    const error = errorOf(k)
    return {
      id: id(k),
      'aria-invalid': error ? true : undefined,
      'aria-describedby': [`${id(k)}-note`, error && `${id(k)}-error`].filter(Boolean).join(' '),
    } as const
  }

  const row = (k: Part, note: string, control: ReactNode) => {
    const error = errorOf(k)
    return (
      <div className="gap-1 flex flex-col">
        <label htmlFor={id(k)} className="font-medium">
          {t(`seo.${k}`)}
        </label>
        {control}
        <p id={`${id(k)}-note`} className="text-sm text-neutral-500">
          {note}
        </p>
        {error && (
          <p id={`${id(k)}-error`} className="text-sm text-red-700">
            {t(error.key, { max: error.max, min: error.min })}
          </p>
        )}
      </div>
    )
  }
  const count = (k: Part, max: number) => t('seo.count', { count: str(k).length, max })

  const host = config.site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const crumbs = [host, ...(previewPath ?? '').split('/').filter(Boolean)].join(' › ')

  return (
    <fieldset className="gap-4 rounded-lg border-neutral-200 p-4 flex flex-col border">
      <legend className="px-1 font-medium">{t('seo.label')}</legend>

      {row(
        'keyword',
        t('seo.keywordHelp'),
        <input
          {...describe('keyword')}
          type="text"
          className={inputClass}
          value={str('keyword')}
          onChange={(e) => {
            set('keyword', e.target.value)
          }}
        />,
      )}

      {row(
        'title',
        count('title', SEO_TITLE_MAX),
        <input
          {...describe('title')}
          type="text"
          className={inputClass}
          value={str('title')}
          placeholder={fallback.title ?? undefined}
          onChange={(e) => {
            set('title', e.target.value)
          }}
        />,
      )}

      {row(
        'description',
        count('description', SEO_DESCRIPTION_MAX),
        <textarea
          {...describe('description')}
          rows={3}
          className={inputClass}
          value={str('description')}
          placeholder={fallback.description ?? undefined}
          onChange={(e) => {
            set('description', e.target.value)
          }}
        />,
      )}

      {row(
        'image',
        t('seo.imageHelp'),
        <ImageInput
          id={id('image')}
          describedBy={describe('image')['aria-describedby']}
          invalid={Boolean(errorOf('image'))}
          value={own.image}
          onChange={(v) => {
            set('image', v)
          }}
        />,
      )}

      <div
        role="group"
        aria-label={t('seo.preview')}
        className="gap-1 bg-white p-4 shadow-sm rounded-lg border-neutral-200 flex flex-col border"
      >
        <p className="text-sm font-medium text-neutral-500">{t('seo.preview')}</p>
        <p className="text-sm text-neutral-600">{crumbs}</p>
        <p className="text-xl text-blue-800">{meta.title ?? t('seo.noTitle')}</p>
        <p className="text-sm text-neutral-700">{meta.description ?? t('seo.noDescription')}</p>
      </div>
    </fieldset>
  )
}
