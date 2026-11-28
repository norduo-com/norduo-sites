import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { badgesOf, type CollectionConfig, type ListedDoc, NEW_ITEM } from '../define'
import { collectionLabelKey, noteKey } from '../labels'
import type { AdminDocument } from '../server'
import type { AdminApi } from './api'
import type { EditorDoc } from './Editor'
import { Badges, ListMessages, Note } from './Notices'
import { LocalizedEditor } from './TranslationEditor'

const NEW = Symbol('new')

interface Props {
  api: AdminApi
  name: string
  collection: CollectionConfig
  /** Vefstjórn's base path, e.g. "/vefstjorn". */
  base: string
  /** The path after the collection's own, e.g. a slug on a table layout's edit page. */
  sub: string
}

/** A collection's screen, in the layout its config asks for. */
export function CollectionScreen(props: Props) {
  if (props.collection.layout !== 'table') return <SplitScreen {...props} />
  return props.sub ? <ItemScreen {...props} /> : <TableScreen {...props} />
}

/** The collection's items, with what its hooks make of them. */
function useCollection(api: AdminApi, name: string, collection: CollectionConfig) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const [items, setItems] = useState<AdminDocument[] | null>(null)
  const [loadError, setLoadError] = useState(false)

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

  const warnings = useMemo(
    () => (items && collection.warnings ? collection.warnings(items.map(listed)) : []),
    [items, collection],
  )
  // The notice is read once per visit; a season doesn't turn while a list is open.
  const [notice] = useState(() => collection.list?.notice?.(new Date()) ?? null)

  const titleOf = (doc: { data: Record<string, unknown> }) => {
    const value = collection.titleField ? doc.data[collection.titleField] : undefined
    return typeof value === 'string' && value ? value : t('list.untitled')
  }

  /** Puts a saved item in the list, so warnings and titles follow it. */
  const saved = (doc: EditorDoc & { slug: string }, previous: string | null) => {
    setItems((list) => {
      const row = { ...doc, locale: '', translations: null, updatedAt: Date.now() }
      const all = list ?? []
      return all.some((i) => i.slug === previous)
        ? all.map((i) => (i.slug === previous ? row : i))
        : [...all, row]
    })
  }

  return {
    items,
    setItems,
    loadError,
    warnings,
    notice,
    titleOf,
    saved,
    heading: t(collectionLabelKey(name), { ns: 'cms' }),
    note: collection.note ? t(noteKey(`collections.${name}`), { ns: 'cms' }) : null,
  }
}

const listed = (doc: AdminDocument): ListedDoc => ({
  slug: doc.slug,
  status: doc.status,
  data: doc.data,
})

function StatusTag({ status }: { status: AdminDocument['status'] }) {
  const { t } = useTranslation('vefstjorn')
  return (
    <span
      className={
        status === 'published'
          ? 'bg-green-100 px-2 text-sm text-green-900 rounded-full'
          : 'bg-neutral-200 px-2 text-sm text-neutral-700 rounded-full'
      }
    >
      {t(`status.${status}`)}
    </span>
  )
}

const primaryButton = 'rounded-lg bg-neutral-900 px-3 py-1.5 text-white'

/**
 * Split layout: the collection's items on the left, the selected one's editor beside it.
 * Each item saves on its own with its own Drög/Birt.
 */
function SplitScreen({ api, name, collection }: Props) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const list = useCollection(api, name, collection)
  const { items, loadError, heading } = list
  const [selected, setSelected] = useState<string | typeof NEW | null>(null)
  // Bumped when the editor should start fresh; saving a new item keeps the same editor.
  const [session, setSession] = useState(0)
  const open = (target: string | typeof NEW) => {
    setSelected(target)
    setSession((n) => n + 1)
  }
  const drafts = collection.drafts === true

  const current: EditorDoc | null =
    selected === NEW
      ? { slug: null, status: 'draft', data: {} }
      : (items?.find((i) => i.slug === selected) ?? null)

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
            className={primaryButton}
          >
            {t('actions.new')}
          </button>
        </div>
        <ListMessages notice={list.notice} warnings={list.warnings} />
        {list.note && <Note text={list.note} />}
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
                  className="gap-3 rounded-lg bg-white px-3 py-2 aria-current:ring-neutral-900 flex w-full flex-wrap items-center justify-between text-left aria-current:ring-2"
                >
                  <span>{list.titleOf(doc)}</span>
                  <span className="gap-2 flex flex-wrap items-center">
                    <Badges badges={badgesOf(collection, listed(doc))} />
                    {drafts && <StatusTag status={doc.status} />}
                  </span>
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
              owner={`collections.${name}`}
              fields={collection.fields}
              drafts={drafts}
              doc={current}
              onSaved={(saved) => {
                list.saved(saved, current.slug)
                setSelected(saved.slug)
              }}
              onDeleted={() => {
                list.setItems((all) => all?.filter((i) => i.slug !== current.slug) ?? null)
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

const dateFormat = new Intl.DateTimeFormat('is-IS', { dateStyle: 'medium' })

/** Table layout: every item in a table; each opens on its own edit page. */
function TableScreen({ api, name, collection, base }: Props) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const list = useCollection(api, name, collection)
  const { items, loadError, heading } = list
  const drafts = collection.drafts === true

  return (
    <section aria-labelledby={`${name}-heading`} className="gap-4 flex flex-col">
      <div className="gap-3 flex items-center justify-between">
        <h1 id={`${name}-heading`} className="text-2xl">
          {heading}
        </h1>
        <a href={`${base}/${name}/${NEW_ITEM}`} className={primaryButton}>
          {t('actions.new')}
        </a>
      </div>
      <ListMessages notice={list.notice} warnings={list.warnings} />
      {list.note && <Note text={list.note} />}
      {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
      {!items && !loadError && <p>{t('list.loading')}</p>}
      {items?.length === 0 && <p className="text-neutral-500">{t('list.empty')}</p>}
      {items && items.length > 0 && (
        <div className="bg-white overflow-x-auto rounded-card">
          <table className="w-full text-left">
            <thead className="text-sm text-neutral-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('table.title')}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('table.tags')}
                </th>
                {drafts && (
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('status.label')}
                  </th>
                )}
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('table.updated')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc.slug} className="border-neutral-100 border-t">
                  <th scope="row" className="px-4 py-2 font-normal">
                    <a
                      href={`${base}/${name}/${encodeURIComponent(doc.slug)}`}
                      className="hover:underline"
                    >
                      {list.titleOf(doc)}
                    </a>
                  </th>
                  <td className="px-4 py-2">
                    <Badges badges={badgesOf(collection, listed(doc))} />
                  </td>
                  {drafts && (
                    <td className="px-4 py-2">
                      <StatusTag status={doc.status} />
                    </td>
                  )}
                  <td className="px-4 py-2 text-sm text-neutral-600">
                    {dateFormat.format(doc.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * A table layout's edit page for one item, or a new one at `<collection>/_new`, which moves to
 * the item's own address on its first save.
 */
function ItemScreen({ api, name, collection, base, sub }: Props) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const list = useCollection(api, name, collection)
  const { items, loadError, heading } = list
  const [slug, setSlug] = useState<string | null>(sub === NEW_ITEM ? null : sub)
  // Saving a new item keeps the same editor, so nothing typed since is lost.
  const [created, setCreated] = useState<EditorDoc | null>(null)
  const listHref = `${base}/${name}`

  const found = slug === null ? undefined : items?.find((i) => i.slug === slug)
  // Waits for the list (its warnings), so the form never renders on the server, where typing
  // before hydration would be lost.
  const current: EditorDoc | null = !items
    ? null
    : slug === null
      ? { slug: null, status: 'draft', data: {} }
      : (created ?? found ?? null)

  return (
    <div className="gap-6 lg:grid-cols-[1fr_minmax(14rem,20rem)] grid items-start">
      <section aria-labelledby={`${name}-item-heading`} className="gap-4 flex flex-col">
        <a href={listHref} className="text-sm text-neutral-600 hover:underline">
          ← {heading}
        </a>
        <h1 id={`${name}-item-heading`} className="text-2xl">
          {current?.slug ? list.titleOf(current) : t('editor.new')}
        </h1>
        {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
        {!items && !loadError && <p>{t('list.loading')}</p>}
        {slug !== null && items && !found && !created && <p role="alert">{t('editor.notFound')}</p>}
        {current && (
          <div className="bg-white rounded-card p-tp">
            <LocalizedEditor
              api={api}
              type={name}
              owner={`collections.${name}`}
              fields={collection.fields}
              drafts={collection.drafts === true}
              doc={current}
              onSaved={(saved) => {
                list.saved(saved, current.slug)
                setCreated(saved)
                if (saved.slug !== slug) {
                  window.history.replaceState(
                    null,
                    '',
                    `${listHref}/${encodeURIComponent(saved.slug)}`,
                  )
                }
                setSlug(saved.slug)
              }}
              onDeleted={() => {
                window.location.assign(listHref)
              }}
            />
          </div>
        )}
      </section>
      <div className="gap-3 flex flex-col">
        <ListMessages warnings={list.warnings} />
        {list.note && <Note text={list.note} />}
      </div>
    </div>
  )
}
