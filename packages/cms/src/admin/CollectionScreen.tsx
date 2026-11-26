import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CollectionConfig } from '../define'
import { collectionLabelKey } from '../labels'
import type { AdminDocument } from '../server'
import type { AdminApi } from './api'
import type { EditorDoc } from './Editor'
import { LocalizedEditor } from './TranslationEditor'

const NEW = Symbol('new')

/**
 * Split layout: the collection's items on the left, the selected one's editor beside it.
 * Each item saves on its own with its own Drög/Birt.
 */
export function CollectionScreen({
  api,
  name,
  collection,
}: {
  api: AdminApi
  name: string
  collection: CollectionConfig
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const [items, setItems] = useState<AdminDocument[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [selected, setSelected] = useState<string | typeof NEW | null>(null)
  // Bumped when the editor should start fresh; saving a new item keeps the same editor.
  const [session, setSession] = useState(0)
  const open = (target: string | typeof NEW) => {
    setSelected(target)
    setSession((n) => n + 1)
  }
  const drafts = collection.drafts === true
  const owner = `collections.${name}`

  useEffect(() => {
    let live = true
    api.list(name).then(
      (list) => {
        if (live) setItems(list)
      },
      () => {
        if (live) setLoadError(true)
      },
    )
    return () => {
      live = false
    }
  }, [api, name])

  const titleOf = (doc: AdminDocument) => {
    const value = collection.titleField ? doc.data[collection.titleField] : undefined
    return typeof value === 'string' && value ? value : t('list.untitled')
  }

  const current: EditorDoc | null =
    selected === NEW
      ? { slug: null, status: 'draft', data: {} }
      : (items?.find((i) => i.slug === selected) ?? null)

  const heading = t(collectionLabelKey(name), { ns: 'cms' })

  return (
    <div className="gap-6 lg:grid-cols-[minmax(16rem,22rem)_1fr] grid">
      <section aria-labelledby={`${name}-heading`} className="gap-3 flex flex-col">
        <div className="gap-3 flex items-center justify-between">
          <h1 id={`${name}-heading`} className="text-2xl">
            {heading}
          </h1>
          <button
            type="button"
            onClick={() => {
              open(NEW)
            }}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-white"
          >
            {t('actions.new')}
          </button>
        </div>
        {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
        {!items && !loadError && <p>{t('list.loading')}</p>}
        {items?.length === 0 && <p className="text-neutral-500">{t('list.empty')}</p>}
        {items && items.length > 0 && (
          <ul className="gap-1 flex flex-col">
            {items.map((doc) => (
              <li key={doc.slug}>
                <button
                  type="button"
                  aria-current={selected === doc.slug ? 'true' : undefined}
                  onClick={() => {
                    open(doc.slug)
                  }}
                  className="gap-3 rounded-lg bg-white px-3 py-2 aria-current:ring-neutral-900 flex w-full items-center justify-between text-left aria-current:ring-2"
                >
                  <span>{titleOf(doc)}</span>
                  {drafts && (
                    <span
                      className={
                        doc.status === 'published'
                          ? 'bg-green-100 px-2 text-sm text-green-900 rounded-full'
                          : 'bg-neutral-200 px-2 text-sm text-neutral-700 rounded-full'
                      }
                    >
                      {t(`status.${doc.status}`)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label={current?.slug === null ? t('editor.new') : heading}
        className="bg-white rounded-card p-tp"
      >
        {current ? (
          <>
            {current.slug === null && <h2 className="mb-4 text-xl">{t('editor.new')}</h2>}
            <LocalizedEditor
              // A fresh editor per opened item, so unsaved edits never leak between items.
              key={session}
              api={api}
              type={name}
              owner={owner}
              fields={collection.fields}
              drafts={drafts}
              doc={current}
              onSaved={(saved) => {
                setItems((list) => {
                  const doc = { ...saved, locale: '', translations: null, updatedAt: Date.now() }
                  const all = list ?? []
                  return all.some((i) => i.slug === saved.slug)
                    ? all.map((i) => (i.slug === saved.slug ? doc : i))
                    : [...all, doc]
                })
                setSelected(saved.slug)
              }}
              onDeleted={() => {
                setItems((list) => list?.filter((i) => i.slug !== current.slug) ?? null)
                setSelected(null)
              }}
            />
          </>
        ) : (
          <p className="text-neutral-500">{t('editor.pick')}</p>
        )}
      </section>
    </div>
  )
}
