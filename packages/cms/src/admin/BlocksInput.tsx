import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BlockConfig } from '../fields'
import { blockLabelKey } from '../labels'
import { type FieldErrors, FieldInput } from './inputs'
import { inputClass } from './styles'

interface BlockItem {
  type: string
  data: Record<string, unknown>
}

const isBlock = (v: unknown): v is BlockItem =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as BlockItem).type === 'string' &&
  typeof (v as BlockItem).data === 'object'

let nextKey = 0
const newKey = () => `block-${String((nextKey += 1))}`

const smallButton = 'rounded-md px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40'

/**
 * A page's body: an ordered list of blocks from the page's allowed types. Editors add,
 * remove and reorder them; each block's fields are edited in place. Nothing is stored
 * until the page is saved.
 */
export function BlocksInput({
  path,
  idPrefix,
  blocks,
  value,
  onChange,
  errors,
}: {
  path: string
  idPrefix: string
  /** The block types this page allows, by name. */
  blocks: Record<string, BlockConfig>
  value: unknown
  onChange: (value: unknown) => void
  errors: FieldErrors
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const items = Array.isArray(value) ? value.filter(isBlock) : []
  const types = Object.keys(blocks)
  const [adding, setAdding] = useState(types[0] ?? '')
  // Blocks have no ids of their own, so each gets a key that follows it when it moves;
  // rich text inputs keep their own state and must not swap contents.
  const [keys, setKeys] = useState<string[]>(() => items.map(newKey))
  const liveKeys =
    keys.length === items.length ? keys : items.map((_, i) => keys[i] ?? `extra-${String(i)}`)
  // The control to focus after the next render, by its `data-focus` name: buttons that
  // move or vanish would otherwise drop focus to the page.
  const root = useRef<HTMLFieldSetElement>(null)
  const pending = useRef<string | null>(null)
  const setFocus = (name: string) => {
    pending.current = name
  }

  useEffect(() => {
    const name = pending.current
    if (name === null) return
    pending.current = null
    root.current?.querySelector<HTMLElement>(`[data-focus="${name}"]`)?.focus()
  })

  const labelOf = (type: string) => t(blockLabelKey(type), { ns: 'cms' })
  const update = (next: BlockItem[], nextKeys: string[]) => {
    setKeys(nextKeys)
    onChange(next.length ? next : undefined)
  }

  const add = () => {
    if (!Object.hasOwn(blocks, adding)) return
    const key = newKey()
    update([...items, { type: adding, data: {} }], [...liveKeys, key])
    setFocus(`${key}-remove`)
  }
  const remove = (i: number) => {
    update(
      items.filter((_, j) => j !== i),
      liveKeys.filter((_, j) => j !== i),
    )
    setFocus('add')
  }
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= items.length) return
    const swap = <T,>(list: T[]) => {
      const next = [...list]
      ;[next[i], next[j]] = [next[j] as T, next[i] as T]
      return next
    }
    update(swap(items), swap(liveKeys))
    // Keep focus on the moved block; at the top or bottom, on its other move button.
    const key = liveKeys[i] ?? ''
    const dir = by === -1 ? 'up' : 'down'
    const atEnd = by === -1 ? j === 0 : j === items.length - 1
    const opposite = dir === 'up' ? 'down' : 'up'
    setFocus(`${key}-${atEnd ? opposite : dir}`)
  }

  const listError = errors[path]

  return (
    <fieldset ref={root} className="gap-3 flex flex-col">
      <legend className="mb-1 font-medium">{t('blocks.label')}</legend>
      {listError && (
        <p className="text-sm text-red-700">
          {t(listError.key, { max: listError.max, min: listError.min })}
        </p>
      )}
      {items.length === 0 && <p className="text-sm text-neutral-500">{t('blocks.empty')}</p>}
      <ol className="gap-3 flex flex-col">
        {items.map((item, i) => {
          const key = liveKeys[i] ?? String(i)
          const def = Object.hasOwn(blocks, item.type) ? blocks[item.type] : undefined
          const label = labelOf(item.type)
          const position = t('blocks.position', { label, n: i + 1 })
          return (
            <li key={key}>
              <section
                aria-label={position}
                className="gap-4 rounded-lg border-neutral-200 p-4 flex flex-col border"
              >
                <div className="gap-2 flex flex-wrap items-center justify-between">
                  <h3 className="font-medium">{label}</h3>
                  <div className="gap-1 flex">
                    <button
                      type="button"
                      data-focus={`${key}-up`}
                      disabled={i === 0}
                      aria-label={t('blocks.moveUp', { block: position })}
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
                      aria-label={t('blocks.moveDown', { block: position })}
                      onClick={() => {
                        move(i, 1)
                      }}
                      className={smallButton}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      data-focus={`${key}-remove`}
                      aria-label={t('blocks.remove', { block: position })}
                      onClick={() => {
                        remove(i)
                      }}
                      className={`${smallButton} text-red-700 hover:bg-red-50`}
                    >
                      {t('actions.remove')}
                    </button>
                  </div>
                </div>
                {def ? (
                  Object.entries(def.fields).map(([name, field]) => (
                    <FieldInput
                      key={name}
                      owner={`blocks.${item.type}`}
                      name={name}
                      field={field}
                      path={`${path}.${String(i)}.data.${name}`}
                      idPrefix={`${idPrefix}-${key}`}
                      value={item.data[name]}
                      errors={errors}
                      onChange={(v) => {
                        const data = { ...item.data, [name]: v }
                        update(
                          items.map((b, j) => (j === i ? { ...b, data } : b)),
                          liveKeys,
                        )
                      }}
                    />
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">{t('blocks.notAllowed')}</p>
                )}
              </section>
            </li>
          )
        })}
      </ol>
      {types.length > 0 && (
        <div className="gap-2 flex flex-wrap items-center">
          <label htmlFor={`${idPrefix}-${path}-add`} className="sr-only">
            {t('blocks.type')}
          </label>
          <select
            id={`${idPrefix}-${path}-add`}
            className={inputClass}
            value={adding}
            onChange={(e) => {
              setAdding(e.target.value)
            }}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {labelOf(type)}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-focus="add"
            onClick={add}
            className="rounded-lg border-neutral-300 px-3 py-2 hover:bg-neutral-50 border"
          >
            {t('blocks.add')}
          </button>
        </div>
      )}
    </fieldset>
  )
}
