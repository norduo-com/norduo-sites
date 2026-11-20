import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CmsConfig, SingletonConfig } from '../define'
import { collectionLabelKey, singletonLabelKey } from '../labels'
import { type AdminApi, adminApi, ApiError } from './api'
import { CollectionScreen } from './CollectionScreen'
import { Editor, type EditorDoc } from './Editor'

/** Built-in screens that aren't a collection or singleton. */
const MEDIA = 'media'

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
  const singletons = config.singletons ?? {}
  const screen = path.split('/')[0] ?? ''

  const known = [...Object.keys(config.collections), ...Object.keys(singletons), MEDIA]
  const menu = [...(config.admin?.menu ?? []), ...known].filter(
    (id, i, all) => known.includes(id) && all.indexOf(id) === i,
  )
  const labelOf = (id: string) =>
    id === MEDIA
      ? t('nav.media')
      : Object.hasOwn(config.collections, id)
        ? t(collectionLabelKey(id), { ns: 'cms' })
        : t(singletonLabelKey(id), { ns: 'cms' })

  const collection = Object.hasOwn(config.collections, screen)
    ? config.collections[screen]
    : undefined
  const singleton = Object.hasOwn(singletons, screen) ? singletons[screen] : undefined

  return (
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
          <CollectionScreen key={screen} api={api} name={screen} collection={collection} />
        ) : singleton ? (
          <SingletonScreen key={screen} api={api} name={screen} singleton={singleton} />
        ) : screen ? (
          <>
            <h1 className="text-2xl">{labelOf(screen)}</h1>
            <p className="mt-2 text-neutral-500">{t('screens.comingSoon')}</p>
          </>
        ) : (
          <>
            <h1 className="text-3xl">{t('nav.overview')}</h1>
            <p className="mt-2 text-neutral-500">{config.site.name}</p>
          </>
        )}
      </main>
    </div>
  )
}

/** A singleton exists once and goes live on save, so it opens straight into its form. */
function SingletonScreen({
  api,
  name,
  singleton,
}: {
  api: AdminApi
  name: string
  singleton: SingletonConfig
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const [doc, setDoc] = useState<EditorDoc | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    api.get(name, name).then(
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
  }, [api, name])

  return (
    <section className="max-w-2xl gap-4 flex flex-col">
      <h1 className="text-2xl">{t(singletonLabelKey(name), { ns: 'cms' })}</h1>
      {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
      {!doc && !loadError && <p>{t('list.loading')}</p>}
      {doc && (
        <div className="bg-white rounded-card p-tp">
          <Editor
            api={api}
            type={name}
            owner={`singletons.${name}`}
            fields={singleton.fields}
            drafts={false}
            doc={doc}
            onSaved={() => undefined}
          />
        </div>
      )}
    </section>
  )
}
