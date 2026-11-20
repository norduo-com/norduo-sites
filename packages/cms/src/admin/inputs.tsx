import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Field, Fields } from '../fields'
import { choiceLabelKeys, fieldHelpKeys, fieldLabelKeys } from '../labels'
import type { AdminDocument } from '../server'
import { useAdmin } from './context'
import { RichTextInput } from './RichTextInput'

/** Field errors keyed by value path (`cta.heading`), as `vefstjorn` keys with options. */
export type FieldErrors = Record<string, { key: string; max?: number; min?: number }>

/** The error for `path`, or for anything inside it unless `exact`. */
function errorAt(errors: FieldErrors, path: string, exact = false) {
  if (errors[path] || exact) return errors[path]
  const inner = Object.keys(errors).find((k) => k.startsWith(`${path}.`))
  return inner ? errors[inner] : undefined
}

const inputClass =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 aria-invalid:border-red-600'

/** Empty inputs are left out of the data, so an optional field stays valid. */
const orUndefined = (v: string) => (v.trim() === '' ? undefined : v)

interface Kinds {
  text: { multiline: boolean; max?: number }
  select: { choices: readonly string[] }
  multiSelect: { choices: readonly string[]; min: number }
  relation: { to: string; many: boolean }
  slug: { from: string }
  group: { fields: Fields }
  richText: { marks: Record<string, string> }
}
const is = <K extends keyof Kinds>(f: Field, kind: K): f is Field & Kinds[K] => f.kind === kind

/** Kinds this editor can edit; the rest keep their stored value for now. */
const SUPPORTED = new Set([
  'text',
  'email',
  'url',
  'tel',
  'year',
  'toggle',
  'select',
  'multiSelect',
  'relation',
  'monthRange',
  'slug',
  'group',
  'richText',
])

export interface FieldInputProps {
  /** Label key prefix of the field's owner, e.g. "collections.projects". */
  owner: string
  name: string
  field: Field
  /** Path of the value in the document, e.g. "cta.heading". */
  path: string
  idPrefix: string
  value: unknown
  onChange: (value: unknown) => void
  errors: FieldErrors
}

/** One field's input with its label, help text and error, chosen by the field's kind. */
export function FieldInput(props: FieldInputProps) {
  const { owner, name, field, path, idPrefix, value, onChange, errors } = props
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const id = `${idPrefix}-${path}`
  const label = t(fieldLabelKeys(owner, name), { ns: 'cms' })
  const help = t(fieldHelpKeys(owner, name), { ns: 'cms', defaultValue: '' })
  const error = errorAt(errors, path, field.kind === 'group')
  const describedBy = [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(' ')
  const a11y = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const

  const notes = (
    <>
      {help && (
        <p id={`${id}-help`} className="text-sm text-neutral-500">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {t(error.key, { max: error.max, min: error.min })}
        </p>
      )}
    </>
  )
  const star = field.required && <span aria-hidden="true"> *</span>
  const labelled = (control: ReactNode) => (
    <div className="gap-1 flex flex-col">
      <label htmlFor={id} className="font-medium">
        {label}
        {star}
      </label>
      {control}
      {notes}
    </div>
  )
  const grouped = (control: ReactNode) => (
    <fieldset className="gap-1 flex flex-col" {...a11y}>
      <legend className="mb-1 font-medium">
        {label}
        {star}
      </legend>
      {control}
      {notes}
    </fieldset>
  )

  if (!SUPPORTED.has(field.kind)) {
    return (
      <div className="gap-1 flex flex-col">
        <span className="font-medium">{label}</span>
        <p className="text-sm text-neutral-500">{t('editor.unsupported')}</p>
      </div>
    )
  }

  const str = typeof value === 'string' ? value : ''
  const common = { id, name: path, required: field.required, className: inputClass, ...a11y }

  if (is(field, 'text')) {
    const textProps = {
      ...common,
      value: str,
      maxLength: field.max,
      onChange: (e: { target: { value: string } }) => {
        onChange(e.target.value)
      },
    }
    return labelled(
      field.multiline ? <textarea rows={4} {...textProps} /> : <input type="text" {...textProps} />,
    )
  }

  if (field.kind === 'email' || field.kind === 'url' || field.kind === 'tel') {
    return labelled(
      <input
        {...common}
        type={field.kind}
        inputMode={field.kind === 'tel' ? 'tel' : field.kind === 'email' ? 'email' : 'url'}
        autoComplete="off"
        value={str}
        onChange={(e) => {
          onChange(orUndefined(e.target.value))
        }}
      />,
    )
  }

  if (field.kind === 'year') {
    return labelled(
      <input
        {...common}
        type="text"
        inputMode="numeric"
        className={`${inputClass} w-28`}
        value={typeof value === 'number' ? String(value) : str}
        onChange={(e) => {
          const raw = e.target.value.trim()
          // Anything that isn't a whole number is kept as text, so validation flags it.
          onChange(raw === '' ? undefined : /^\d+$/.test(raw) ? Number(raw) : raw)
        }}
      />,
    )
  }

  if (field.kind === 'toggle') {
    return (
      <div className="gap-1 flex flex-col">
        <label className="gap-2 flex items-center">
          <input
            type="checkbox"
            id={id}
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked)
            }}
            {...a11y}
          />
          <span className="font-medium">{label}</span>
        </label>
        {notes}
      </div>
    )
  }

  const choiceLabel = (c: string) => t(choiceLabelKeys(owner, name, c), { ns: 'cms' })

  if (is(field, 'select')) {
    return labelled(
      <select
        {...common}
        value={str}
        onChange={(e) => {
          onChange(orUndefined(e.target.value))
        }}
      >
        <option value="">{t('select.none')}</option>
        {field.choices.map((c) => (
          <option key={c} value={c}>
            {choiceLabel(c)}
          </option>
        ))}
      </select>,
    )
  }

  if (is(field, 'multiSelect')) {
    return grouped(
      <Checkboxes
        name={path}
        options={field.choices.map((c) => ({ value: c, label: choiceLabel(c) }))}
        value={value}
        onChange={onChange}
      />,
    )
  }

  if (is(field, 'relation')) {
    return field.many
      ? grouped(
          <RelationOptions to={field.to}>
            {(options) => (
              <Checkboxes name={path} options={options} value={value} onChange={onChange} />
            )}
          </RelationOptions>,
        )
      : labelled(
          <RelationOptions to={field.to}>
            {(options) => (
              <select
                {...common}
                value={str}
                onChange={(e) => {
                  onChange(orUndefined(e.target.value))
                }}
              >
                <option value="">{t('select.none')}</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </RelationOptions>,
        )
  }

  if (field.kind === 'monthRange') {
    const range = (value ?? {}) as { from?: number; to?: number }
    const set = (end: 'from' | 'to', raw: string) => {
      const next = { ...range, [end]: raw ? Number(raw) : undefined }
      onChange(next.from === undefined && next.to === undefined ? undefined : next)
    }
    return grouped(
      <div className="gap-3 flex flex-wrap items-center">
        {(['from', 'to'] as const).map((end) => (
          <label key={end} className="gap-2 flex items-center">
            {t(`monthRange.${end}`)}
            <select
              className={inputClass}
              value={range[end] === undefined ? '' : String(range[end])}
              onChange={(e) => {
                set(end, e.target.value)
              }}
            >
              <option value="">{t('select.none')}</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {t(`months.${String(i + 1)}`)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>,
    )
  }

  if (is(field, 'slug')) {
    const from = t(fieldLabelKeys(owner, field.from), { ns: 'cms' })
    return (
      <div className="gap-1 flex flex-col">
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        <code id={id} aria-labelledby={`${id}-label`} className="font-mono text-sm">
          {str || t('slug.pending')}
        </code>
        <p className="text-sm text-neutral-500">{t('slug.help', { from })}</p>
      </div>
    )
  }

  if (is(field, 'group')) {
    const group = (value ?? {}) as Record<string, unknown>
    return grouped(
      <div className="gap-4 border-neutral-200 flex flex-col rounded-box border p-in">
        {Object.entries(field.fields).map(([child, def]) => (
          <FieldInput
            key={child}
            owner={`${owner}.fields.${name}`}
            name={child}
            field={def}
            path={`${path}.${child}`}
            idPrefix={idPrefix}
            value={group[child]}
            errors={errors}
            onChange={(v) => {
              const next = { ...group, [child]: v }
              // A group with nothing filled in is left out, so an optional group stays valid.
              onChange(Object.values(next).every((x) => x === undefined) ? undefined : next)
            }}
          />
        ))}
      </div>,
    )
  }

  if (is(field, 'richText')) {
    return (
      <div className="gap-1 flex flex-col">
        <span id={`${id}-label`} className="font-medium">
          {label}
          {star}
        </span>
        <RichTextInput
          id={id}
          labelledBy={`${id}-label`}
          describedBy={describedBy || undefined}
          invalid={Boolean(error)}
          owner={owner}
          name={name}
          marks={field.marks}
          value={value}
          onChange={onChange}
        />
        {notes}
      </div>
    )
  }

  return null
}

interface Option {
  value: string
  label: string
}

function Checkboxes({
  name,
  options,
  value,
  onChange,
}: {
  name: string
  options: Option[]
  value: unknown
  onChange: (value: unknown) => void
}) {
  const checked = Array.isArray(value) ? (value as string[]) : []
  return (
    <div className="gap-x-5 gap-y-1 flex flex-wrap">
      {options.map((o) => (
        <label key={o.value} className="gap-2 flex items-center">
          <input
            type="checkbox"
            name={name}
            value={o.value}
            checked={checked.includes(o.value)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...checked, o.value]
                : checked.filter((v) => v !== o.value)
              // Kept in the options' order, so the stored list doesn't depend on click order.
              onChange(options.map((x) => x.value).filter((v) => next.includes(v)))
            }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/** Loads the items of the collection a relation points to, titled by its `titleField`. */
function RelationOptions({
  to,
  children,
}: {
  to: string
  children: (options: Option[]) => ReactNode
}) {
  const { api, config } = useAdmin()
  const { t } = useTranslation('vefstjorn')
  const [items, setItems] = useState<AdminDocument[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    api.list(to).then(
      (list) => {
        if (live) setItems(list)
      },
      () => {
        if (live) setFailed(true)
      },
    )
    return () => {
      live = false
    }
  }, [api, to])

  if (failed) return <p role="alert">{t('errors.loadFailed')}</p>
  if (!items) return <p className="text-sm text-neutral-500">{t('list.loading')}</p>
  if (items.length === 0) return <p className="text-sm text-neutral-500">{t('relation.empty')}</p>
  const titleField = Object.hasOwn(config.collections, to)
    ? config.collections[to]?.titleField
    : undefined
  const options = items.map((doc) => {
    const title = titleField ? doc.data[titleField] : undefined
    return {
      value: doc.slug,
      label: typeof title === 'string' && title ? title : t('list.untitled'),
    }
  })
  return <>{children(options)}</>
}
