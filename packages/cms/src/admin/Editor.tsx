import { type SyntheticEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { type Fields, schemaOf } from '../fields'
import { type AdminApi, ApiError, type Status } from './api'
import { type FieldErrors, FieldInput } from './inputs'

export interface EditorDoc {
  slug: string | null
  status: Status
  data: Record<string, unknown>
}

/** The value at a Zod issue's path, to tell a missing value from a wrong one. */
function valueAt(data: unknown, path: PropertyKey[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null
        ? (node as Record<PropertyKey, unknown>)[key]
        : undefined,
    data,
  )
}

function errorsFrom(issues: z.core.$ZodIssue[], data: unknown): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of issues) {
    const path = issue.path.map(String).join('.')
    if (path in out) continue
    if (issue.code === 'too_big') out[path] = { key: 'errors.tooLong', max: Number(issue.maximum) }
    else if (issue.code === 'too_small' && issue.origin === 'array' && Number(issue.minimum) > 1)
      out[path] = { key: 'errors.tooFew', min: Number(issue.minimum) }
    else if (
      (issue.code === 'too_small' && issue.origin !== 'number') ||
      (issue.code === 'invalid_type' && valueAt(data, issue.path) === undefined)
    )
      out[path] = { key: 'errors.required' }
    else if (issue.code === 'invalid_format') {
      const format = (issue as { format?: string }).format
      out[path] = {
        key: format === 'email' || format === 'url' ? `errors.${format}` : 'errors.invalid',
      }
    } else out[path] = { key: 'errors.invalid' }
  }
  return out
}

/**
 * Generic editor for one document, built from its fields (see `inputs.tsx`). Field types
 * without an input yet keep their stored value.
 */
export function Editor({
  api,
  type,
  owner,
  fields,
  drafts,
  doc,
  onSaved,
  onDeleted,
}: {
  api: AdminApi
  type: string
  /** Label key prefix, e.g. "collections.equipment". */
  owner: string
  fields: Fields
  drafts: boolean
  doc: EditorDoc
  onSaved: (doc: EditorDoc & { slug: string }) => void
  onDeleted?: () => void
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const formId = useId()
  const [values, setValues] = useState(doc.data)
  const [status, setStatus] = useState<Status>(doc.status)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const hasServerValues = Object.values(fields).some((f) => f.kind === 'slug')

  const failure = (err: unknown, fallback: string) =>
    err instanceof ApiError && err.status === 401 ? t('errors.unauthorized') : t(fallback)

  async function save(e: SyntheticEvent) {
    e.preventDefault()
    setMessage(null)
    const parsed = schemaOf(fields).safeParse(values)
    if (!parsed.success) {
      setErrors(errorsFrom(parsed.error.issues, values))
      setMessage({ tone: 'error', text: t('errors.fixFields') })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const input = { status: drafts ? status : 'published', data: values } as const
      const slug = doc.slug ?? (await api.create(type, input)).slug
      if (doc.slug) await api.update(type, doc.slug, input)
      // The server fills some values itself (slugs), so show what it stored.
      const data = hasServerValues ? (await api.get(type, slug)).data : values
      setValues(data)
      setMessage({ tone: 'ok', text: t('editor.saved') })
      onSaved({ slug, status: input.status, data })
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err, 'errors.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!doc.slug) return
    setBusy(true)
    try {
      await api.remove(type, doc.slug)
      onDeleted?.()
    } catch (err) {
      setMessage({ tone: 'error', text: failure(err, 'errors.deleteFailed') })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} noValidate className="gap-5 flex flex-col">
      {Object.entries(fields).map(([name, field]) => (
        <FieldInput
          key={name}
          owner={owner}
          name={name}
          field={field}
          path={name}
          idPrefix={formId}
          value={values[name]}
          errors={errors}
          onChange={(value) => {
            setValues((v) => ({ ...v, [name]: value }))
          }}
        />
      ))}

      {drafts && (
        <fieldset className="gap-4 flex">
          <legend className="mb-1 font-medium">{t('status.label')}</legend>
          {(['draft', 'published'] as const).map((s) => (
            <label key={s} className="gap-2 flex items-center">
              <input
                type="radio"
                name={`${formId}-status`}
                value={s}
                checked={status === s}
                onChange={() => {
                  setStatus(s)
                }}
              />
              {t(`status.${s}`)}
            </label>
          ))}
        </fieldset>
      )}

      <div className="gap-3 flex flex-wrap items-center">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {busy ? t('actions.saving') : t('actions.save')}
        </button>
        {doc.slug && onDeleted && !confirmingDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmingDelete(true)
            }}
            className="rounded-lg px-4 py-2 text-red-700 hover:bg-red-50"
          >
            {t('actions.delete')}
          </button>
        )}
        <p role="status" className={message?.tone === 'error' ? 'text-red-700' : 'text-green-800'}>
          {message?.text}
        </p>
      </div>

      {confirmingDelete && (
        <div role="alert" className="gap-3 rounded-lg bg-red-50 p-3 flex flex-wrap items-center">
          <p>{t('editor.confirmDelete')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-white"
          >
            {t('actions.confirmDelete')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(false)
            }}
            className="rounded-lg px-3 py-1.5"
          >
            {t('actions.cancel')}
          </button>
        </div>
      )}
    </form>
  )
}
