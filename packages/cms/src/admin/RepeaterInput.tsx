import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Fields } from '../fields'
import { type FieldErrors, FieldInput } from './inputs'

type Item = Record<string, unknown>

const isItem = (v: unknown): v is Item => typeof v === 'object' && v !== null

let nextKey = 0
const newKey = () => `item-${String((nextKey += 1))}`

const smallButton = 'rounded-md px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40'

/**
 * A list of items with the same fields (a service's list items, a block's steps). Editors
 * add, remove and reorder items; an empty list is left out of the data.
 */
export function RepeaterInput({
  owner,
  name,
  label,
  path,
  idPrefix,
  fields,
  value,
  onChange,
  errors,
  translating,
}: {
  /** Label key prefix of the repeater's owner; its items' fields are under `.fields.<name>`. */
  owner: string
  name: string
  label: string
  path: string
  idPrefix: string
  fields: Fields
  value: unknown
  onChange: (value: unknown) => void
  errors: FieldErrors
  /** Editing a translation: items can be edited but not added, removed or moved. */
  translating?: boolean
}) {
  const { t } = useTranslation('vefstjorn')
  const items = Array.isArray(value) ? value.filter(isItem) : []
  // Items have no ids, so each gets a key that follows it when it moves (see BlocksInput).
  const [keys, setKeys] = useState<string[]>(() => items.map(newKey))
  const liveKeys =
    keys.length === items.length ? keys : items.map((_, i) => keys[i] ?? `extra-${String(i)}`)
  const root = useRef<HTMLFieldSetElement>(null)
  const pending = useRef<string | null>(null)

  useEffect(() => {
    const focus = pending.current
    if (focus === null) return
    pending.current = null
    root.current?.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus()
  })

  const update = (next: Item[], nextKeys: string[], focus?: string) => {
    setKeys(nextKeys)
    if (focus) pending.current = focus
    onChange(next.length ? next : undefined)
  }
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= items.length) return
    const swap = <T,>(list: T[]) => {
      const next = [...list]
      ;[next[i], next[j]] = [next[j] as T, next[i] as T]
      return next
    }
    const atEnd = by === -1 ? j === 0 : j === items.length - 1
    const dir = by === -1 ? 'up' : 'down'
    const opposite = dir === 'up' ? 'down' : 'up'
    update(swap(items), swap(liveKeys), `${liveKeys[i] ?? ''}-${atEnd ? opposite : dir}`)
  }

  const listError = errors[path]
  const childOwner = `${owner}.fields.${name}`

  return (
    <fieldset ref={root} className="gap-3 flex flex-col">
      <legend className="mb-1 font-medium">{label}</legend>
      {listError && (
        <p className="text-sm text-red-700">
          {t(listError.key, { max: listError.max, min: listError.min })}
        </p>
      )}
      {items.length === 0 && <p className="text-sm text-neutral-500">{t('repeater.empty')}</p>}
      <ol className="gap-3 flex flex-col">
        {items.map((item, i) => {
          const key = liveKeys[i] ?? String(i)
          const position = t('repeater.position', { label, n: i + 1 })
          return (
            <li key={key}>
              <section
                aria-label={position}
                tabIndex={-1}
                data-focus={key}
                className="gap-4 rounded-lg border-neutral-200 p-4 flex flex-col border"
              >
                <div className="gap-2 flex flex-wrap items-center justify-between">
                  <h3 className="text-sm font-medium text-neutral-600">{position}</h3>
                  {!translating && (
                    <div className="gap-1 flex">
                      <button
                        type="button"
                        data-focus={`${key}-up`}
                        disabled={i === 0}
                        aria-label={t('repeater.moveUp', { item: position })}
                        onClick={() => {
                          move(i, -1)
                        }}
                        className={smallButton}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        data-focus={`${key}-down`}
                        disabled={i === items.length - 1}
                        aria-label={t('repeater.moveDown', { item: position })}
                        onClick={() => {
                          move(i, 1)
                        }}
                        className={smallButton}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={t('repeater.remove', { item: position })}
                        onClick={() => {
                          update(
                            items.filter((_, j) => j !== i),
                            liveKeys.filter((_, j) => j !== i),
                            'add',
                          )
                        }}
                        className={`${smallButton} text-red-700 hover:bg-red-50`}
                      >
                        {t('actions.remove')}
                      </button>
                    </div>
                  )}
                </div>
                {Object.entries(fields).map(([child, def]) => (
                  <FieldInput
                    key={child}
                    owner={childOwner}
                    name={child}
                    field={def}
                    path={`${path}.${String(i)}.${child}`}
                    idPrefix={`${idPrefix}-${key}`}
                    value={item[child]}
                    errors={errors}
                    translating={translating}
                    onChange={(v) => {
                      update(
                        items.map((x, j) => (j === i ? { ...x, [child]: v } : x)),
                        liveKeys,
                      )
                    }}
                  />
                ))}
              </section>
            </li>
          )
        })}
      </ol>
      {!translating && (
        <div>
          <button
            type="button"
            data-focus="add"
            onClick={() => {
              const key = newKey()
              update([...items, {}], [...liveKeys, key], key)
            }}
            className="rounded-lg border-neutral-300 px-3 py-2 hover:bg-neutral-50 border"
          >
            {t('repeater.add', { label })}
          </button>
        </div>
      )}
    </fieldset>
  )
}
