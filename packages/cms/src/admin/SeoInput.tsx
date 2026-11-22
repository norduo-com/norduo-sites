import { useTranslation } from 'react-i18next'

import { SEO_DESCRIPTION_MAX, type SeoField, seoMeta } from '../seo'
import { useAdmin } from './context'
import { ImageInput } from './ImageInput'
import type { FieldErrors } from './inputs'

const inputClass =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 aria-invalid:border-red-600'

const TITLE_MAX = 60

/**
 * The `seo()` field: keyword, title, description and share image, with a Google preview.
 * Empty title and description show their fallbacks as placeholders and in the preview.
 */
export function SeoInput({
  field,
  path,
  idPrefix,
  value,
  doc,
  previewPath,
  errors,
  onChange,
}: {
  field: SeoField
  path: string
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
  const fallback = seoMeta(field, { ...doc, [path]: undefined }, path)
  const meta = seoMeta(field, doc, path)
  const str = (k: string) => (typeof own[k] === 'string' ? own[k] : '')

  const set = (key: string, v: unknown) => {
    const next = { ...own, [key]: typeof v === 'string' && v.trim() === '' ? undefined : v }
    // Nothing filled in: leave the field out, so an optional seo() stays valid.
    onChange(Object.values(next).every((x) => x === undefined) ? undefined : next)
  }

  const id = (k: string) => `${idPrefix}-${path}.${k}`
  const errorOf = (k: string) => errors[`${path}.${k}`]
  const a11y = (k: string, extra?: string) => {
    const error = errorOf(k)
    const describedBy = [extra, error && `${id(k)}-error`].filter(Boolean).join(' ')
    return {
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy || undefined,
    } as const
  }
  const errorText = (k: string) => {
    const error = errorOf(k)
    return (
      error && (
        <p id={`${id(k)}-error`} className="text-sm text-red-700">
          {t(error.key, { max: error.max, min: error.min })}
        </p>
      )
    )
  }
  const counter = (k: string, max: number) => (
    <p id={`${id(k)}-count`} className="text-sm text-neutral-500">
      {t('seo.count', { count: str(k).length, max })}
    </p>
  )

  const host = config.site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const crumbs = [host, ...(previewPath ?? '').split('/').filter(Boolean)].join(' › ')

  return (
    <fieldset className="gap-4 rounded-lg border-neutral-200 p-4 flex flex-col border">
      <legend className="px-1 font-medium">{t('seo.label')}</legend>

      <div className="gap-1 flex flex-col">
        <label htmlFor={id('keyword')} className="font-medium">
          {t('seo.keyword')}
        </label>
        <input
          id={id('keyword')}
          type="text"
          className={inputClass}
          value={str('keyword')}
          {...a11y('keyword', `${id('keyword')}-help`)}
          onChange={(e) => {
            set('keyword', e.target.value)
          }}
        />
        <p id={`${id('keyword')}-help`} className="text-sm text-neutral-500">
          {t('seo.keywordHelp')}
        </p>
        {errorText('keyword')}
      </div>

      <div className="gap-1 flex flex-col">
        <label htmlFor={id('title')} className="font-medium">
          {t('seo.title')}
        </label>
        <input
          id={id('title')}
          type="text"
          className={inputClass}
          value={str('title')}
          placeholder={fallback.title ?? undefined}
          {...a11y('title', `${id('title')}-count`)}
          onChange={(e) => {
            set('title', e.target.value)
          }}
        />
        {counter('title', TITLE_MAX)}
        {errorText('title')}
      </div>

      <div className="gap-1 flex flex-col">
        <label htmlFor={id('description')} className="font-medium">
          {t('seo.description')}
        </label>
        <textarea
          id={id('description')}
          rows={3}
          className={inputClass}
          value={str('description')}
          placeholder={fallback.description ?? undefined}
          {...a11y('description', `${id('description')}-count`)}
          onChange={(e) => {
            set('description', e.target.value)
          }}
        />
        {counter('description', SEO_DESCRIPTION_MAX)}
        {errorText('description')}
      </div>

      <div className="gap-1 flex flex-col">
        <label htmlFor={id('image')} className="font-medium">
          {t('seo.image')}
        </label>
        <ImageInput
          id={id('image')}
          describedBy={`${id('image')}-help`}
          invalid={Boolean(errorOf('image'))}
          value={own.image}
          onChange={(v) => {
            set('image', v)
          }}
        />
        <p id={`${id('image')}-help`} className="text-sm text-neutral-500">
          {t('seo.imageHelp')}
        </p>
        {errorText('image')}
      </div>

      <figure className="gap-1 flex flex-col">
        <figcaption className="text-sm font-medium text-neutral-500">{t('seo.preview')}</figcaption>
        <div
          aria-label={t('seo.preview')}
          role="group"
          className="gap-1 bg-white p-4 shadow-sm rounded-lg border-neutral-200 flex flex-col border"
        >
          <p className="text-sm text-neutral-600">{crumbs}</p>
          <p className="text-xl text-blue-800">{meta.title ?? t('seo.noTitle')}</p>
          <p className="text-sm text-neutral-700">{meta.description ?? t('seo.noDescription')}</p>
        </div>
      </figure>
    </fieldset>
  )
}
