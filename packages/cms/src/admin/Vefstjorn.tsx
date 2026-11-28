import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type CmsConfig, MEDIA_SCREEN, pageFields, PAGES_SCREEN } from '../define'
import type { Fields } from '../fields'
import {
  collectionLabelKey,
  noteKey,
  pageLabelKey,
  shortcutLabelKey,
  singletonLabelKey,
} from '../labels'
import { type AdminApi, adminApi, ApiError } from './api'
import { CollectionScreen } from './CollectionScreen'
import { AdminContext } from './context'
import type { EditorDoc } from './Editor'
import { MediaScreen } from './MediaScreen'
import { Note } from './Notices'
import { LocalizedEditor } from './TranslationEditor'

/**
 * Admin shell. Screens are generated from the site's config: one list + editor per
 * collection, one form per singleton. Labels come from the `vefstjorn` and `cms` namespaces.
 *
 * `path` is the part of the URL after the admin base, e.g. "equipment".
 */
export function Vefstjorn({
  config,
  path,
  base = '/vefstjorn',
  apiBase = '/api/cms',
}: {
  config: CmsConfig
  path: string
  base?: string
  apiBase?: string
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const api = useMemo(() => adminApi(apiBase), [apiBase])
  const admin = useMemo(() => ({ api, config }), [api, config])
  const singletons = config.singletons ?? {}
  const [screen = '', sub = ''] = path.split('/')
  const pages = config.pages ?? {}
  // Singletons shown under Síður og textar (the footer) aren't in the menu themselves.
  const underPages = Object.keys(singletons).filter(
    (s) => singletons[s]?.showUnder === PAGES_SCREEN,
  )
  const hasPagesScreen = Object.keys(pages).length > 0 || underPages.length > 0

  const known = [
    ...Object.keys(config.collections),
    ...Object.keys(singletons).filter((s) => !underPages.includes(s)),
    ...(hasPagesScreen ? [PAGES_SCREEN] : []),
    MEDIA_SCREEN,
  ]
  const menu = [...(config.admin?.menu ?? []), ...known].filter(
    (id, i, all) => known.includes(id) && all.indexOf(id) === i,
  )
  const labelOf = (id: string) =>
    id === MEDIA_SCREEN
      ? t('nav.media')
      : id === PAGES_SCREEN
        ? t('nav.pages')
        : Object.hasOwn(config.collections, id)
          ? t(collectionLabelKey(id), { ns: 'cms' })
          : t(singletonLabelKey(id), { ns: 'cms' })

  const collection = Object.hasOwn(config.collections, screen)
    ? config.collections[screen]
    : undefined
  const singleton = Object.hasOwn(singletons, screen) ? singletons[screen] : undefined

  /** One page or footer-like singleton, opened from Síður og textar. */
  const pageScreen = () => {
    const back = { href: `${base}/${PAGES_SCREEN}`, label: t('nav.pages') }
    if (Object.hasOwn(pages, sub)) {
      return (
        <DocumentScreen
          key={sub}
          api={api}
          type={PAGES_SCREEN}
          name={sub}
          owner={`pages.${sub}`}
          heading={t(pageLabelKey(sub), { ns: 'cms' })}
          note={pages[sub]?.note ? t(noteKey(`pages.${sub}`), { ns: 'cms' }) : undefined}
          fields={pageFields(config, sub)}
          previewPath={pages[sub]?.route}
          back={back}
        />
      )
    }
    if (underPages.includes(sub)) {
      return (
        <DocumentScreen
          key={sub}
          api={api}
          type={sub}
          name={sub}
          owner={`singletons.${sub}`}
          heading={t(singletonLabelKey(sub), { ns: 'cms' })}
          note={singletons[sub]?.note ? t(noteKey(`singletons.${sub}`), { ns: 'cms' }) : undefined}
          fields={singletons[sub]?.fields ?? {}}
          back={back}
        />
      )
    }
    return (
      <PagesScreen
        base={base}
        items={[
          ...Object.entries(pages).map(([name, p]) => ({
            name,
            label: t(pageLabelKey(name), { ns: 'cms' }),
            route: p.route,
          })),
          ...underPages.map((name) => ({ name, label: t(singletonLabelKey(name), { ns: 'cms' }) })),
        ]}
      />
    )
  }

  return (
    <AdminContext.Provider value={admin}>
      <div className="md:flex-row flex min-h-screen flex-col">
        <nav
          aria-label={t('nav.label')}
          className="gap-1 bg-neutral-900 p-4 text-white md:w-64 flex flex-col"
        >
          <a href={base} className="mb-4 text-sm tracking-widest uppercase">
            {config.admin?.title ?? t('title')}
          </a>
          {menu.map((id) => (
            <a
              key={id}
              href={`${base}/${id}`}
              aria-current={screen === id ? 'page' : undefined}
              className="rounded-lg px-3 py-2 hover:bg-white/10 aria-[current=page]:bg-white/15"
            >
              {labelOf(id)}
            </a>
          ))}
        </nav>
        <main className="flex-1 p-g">
          {collection ? (
            <CollectionScreen
              key={screen}
              api={api}
              name={screen}
              collection={collection}
              base={base}
              sub={sub}
            />
          ) : singleton ? (
            <DocumentScreen
              key={screen}
              api={api}
              type={screen}
              name={screen}
              owner={`singletons.${screen}`}
              heading={t(singletonLabelKey(screen), { ns: 'cms' })}
              note={singleton.note ? t(noteKey(`singletons.${screen}`), { ns: 'cms' }) : undefined}
              fields={singleton.fields}
            />
          ) : screen === PAGES_SCREEN && hasPagesScreen ? (
            pageScreen()
          ) : screen === MEDIA_SCREEN ? (
            <MediaScreen api={api} config={config} base={base} />
          ) : screen ? (
            <>
              <h1 className="text-2xl">{labelOf(screen)}</h1>
              <p className="mt-2 text-neutral-500">{t('screens.comingSoon')}</p>
            </>
          ) : (
            <>
              <h1 className="text-3xl">{t('nav.overview')}</h1>
              <p className="mt-2 text-neutral-500">{config.site.name}</p>
              {config.admin?.shortcuts && (
                <nav aria-label={t('overview.shortcuts')} className="mt-6 gap-2 flex flex-wrap">
                  {config.admin.shortcuts.map((s) => (
                    <a
                      key={s.name}
                      href={`${base}/${s.to}`}
                      className="rounded-lg bg-white px-4 py-2 hover:bg-neutral-50"
                    >
                      {t(shortcutLabelKey(s.name), { ns: 'cms' })}
                    </a>
                  ))}
                </nav>
              )}
            </>
          )}
        </main>
      </div>
    </AdminContext.Provider>
  )
}

/** Síður og textar: the site's fixed pages, then the singletons shown with them. */
function PagesScreen({
  base,
  items,
}: {
  base: string
  items: { name: string; label: string; route?: string }[]
}) {
  const { t } = useTranslation('vefstjorn')
  return (
    <section aria-labelledby="pages-heading" className="max-w-2xl gap-3 flex flex-col">
      <h1 id="pages-heading" className="text-2xl">
        {t('nav.pages')}
      </h1>
      <ul className="gap-1 flex flex-col">
        {items.map((item) => (
          <li key={item.name}>
            <a
              href={`${base}/${PAGES_SCREEN}/${item.name}`}
              className="gap-3 rounded-lg bg-white px-3 py-2 hover:bg-neutral-50 flex items-center justify-between"
            >
              <span>{item.label}</span>
              {item.route && (
                <code className="font-mono text-sm text-neutral-500">{item.route}</code>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * A document that exists once and goes live on save (a singleton or a page), so it opens
 * straight into its form. Its first save creates it.
 */
function DocumentScreen({
  api,
  type,
  name,
  owner,
  heading,
  note,
  fields,
  previewPath,
  back,
}: {
  api: AdminApi
  /** Pages are all stored under type "pages", with their name as the slug. */
  type: string
  name: string
  owner: string
  heading: string
  /** The text of the config's side card, if it has one. */
  note?: string
  fields: Fields
  previewPath?: string
  back?: { href: string; label: string }
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const [doc, setDoc] = useState<EditorDoc | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    api.get(type, name).then(
      (d) => {
        setDoc(d)
      },
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          // Not saved yet: its first save creates it.
          setDoc({ slug: name, status: 'published', data: {} })
        } else setLoadError(true)
      },
    )
  }, [api, type, name])

  return (
    <section className="max-w-2xl gap-4 flex flex-col">
      {back && (
        <a href={back.href} className="text-sm text-neutral-600 hover:underline">
          ← {back.label}
        </a>
      )}
      <h1 className="text-2xl">{heading}</h1>
      {note && <Note text={note} />}
      {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
      {!doc && !loadError && <p>{t('list.loading')}</p>}
      {doc && (
        <div className="bg-white rounded-card p-tp">
          <LocalizedEditor
            api={api}
            type={type}
            owner={owner}
            fields={fields}
            drafts={false}
            doc={doc}
            previewPath={previewPath}
            onSaved={() => undefined}
          />
        </div>
      )}
    </section>
  )
}
