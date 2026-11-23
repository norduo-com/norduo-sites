import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type CmsConfig, PAGES_SCREEN } from '../define'
import { collectionLabelKey, pageLabelKey, singletonLabelKey } from '../labels'
import { imageUrl } from '../media'
import type { AdminMedia, MediaUseRef, MediaUses } from '../server'
import { type AdminApi, ApiError } from './api'
import { inputClass } from './styles'
import { IMAGE_ACCEPT, UploadError, type UploadErrorCode, uploadImage } from './upload'

const ALL = ''
const UNUSED = ':unused'
const NO_ALT = ':noAlt'

/** Where a document is edited and what owns it, e.g. `collections.equipment`. */
function ownerOf(config: CmsConfig, ref: { type: string; slug: string }) {
  if (ref.type === PAGES_SCREEN && Object.hasOwn(config.pages ?? {}, ref.slug))
    return { key: pageLabelKey(ref.slug), path: `${PAGES_SCREEN}/${ref.slug}` }
  if (Object.hasOwn(config.collections, ref.type))
    return { key: collectionLabelKey(ref.type), path: ref.type }
  const underPages = config.singletons?.[ref.type]?.showUnder === PAGES_SCREEN
  return {
    key: singletonLabelKey(ref.type),
    path: underPages ? `${PAGES_SCREEN}/${ref.type}` : ref.type,
  }
}

/**
 * Myndasafn: every photo, filtered by where it's used (the collections, pages and singletons
 * that use it), Ónotaðar or Án lýsingar. Alt text is edited here, once for every use. A photo
 * used in an `image()` field can't be deleted; one only in galleries is removed from them
 * after a confirmation.
 */
export function MediaScreen({
  api,
  config,
  base,
}: {
  api: AdminApi
  config: CmsConfig
  base: string
}) {
  const { t } = useTranslation(['vefstjorn', 'cms'])
  const [items, setItems] = useState<AdminMedia[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [filter, setFilter] = useState(ALL)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<{ code: UploadErrorCode; detail?: string } | null>(
    null,
  )
  const picker = useRef<HTMLInputElement>(null)
  const filterId = useId()
  const searchId = useId()

  const load = useCallback(() => {
    api.listMedia().then(
      (list) => {
        setItems(list)
        setLoadError(false)
      },
      () => {
        setLoadError(true)
      },
    )
  }, [api])
  useEffect(load, [load])

  const labelOf = (ref: { type: string; slug: string }) =>
    t(ownerOf(config, ref).key, { ns: 'cms' })

  // One filter per owner in use: a collection, a singleton, or a page.
  const owners = [
    ...new Map(
      (items ?? []).flatMap((m) => m.uses).map((u) => [ownerOf(config, u).key, labelOf(u)]),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1], 'is'))

  const needle = query.trim().toLocaleLowerCase('is')
  const shown = (items ?? []).filter((m) => {
    if (filter === UNUSED && m.uses.length > 0) return false
    if (filter === NO_ALT && m.alt) return false
    if (filter !== ALL && !filter.startsWith(':')) {
      if (!m.uses.some((u) => ownerOf(config, u).key === filter)) return false
    }
    if (!needle) return true
    return [m.filename, m.alt ?? ''].some((s) => s.toLocaleLowerCase('is').includes(needle))
  })

  async function upload(files: File[]) {
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of files) await uploadImage(api, file)
    } catch (err) {
      setUploadError(
        err instanceof UploadError ? { code: err.code, detail: err.detail } : { code: 'failed' },
      )
    } finally {
      setUploading(false)
      load()
    }
  }

  return (
    <section aria-labelledby="media-heading" className="gap-4 flex flex-col">
      <div className="gap-3 flex flex-wrap items-center justify-between">
        <h1 id="media-heading" className="text-2xl">
          {t('nav.media')}
        </h1>
        <input
          ref={picker}
          type="file"
          multiple
          accept={IMAGE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label={t('media.upload')}
          disabled={uploading}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) void upload(files)
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => picker.current?.click()}
          className="rounded-lg bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-60"
        >
          {uploading ? t('image.uploading') : t('media.upload')}
        </button>
      </div>
      {uploadError && (
        <p role="alert" className="text-sm text-red-700">
          {t(`image.errors.${uploadError.code}`)}
          {uploadError.detail && (
            <span className="text-xs text-neutral-500 block">
              {t('image.errorDetail', { detail: uploadError.detail })}
            </span>
          )}
        </p>
      )}

      <div className="gap-3 flex flex-wrap items-end">
        <div className="gap-1 flex flex-col">
          <label htmlFor={filterId} className="text-sm text-neutral-600">
            {t('media.filter')}
          </label>
          <select
            id={filterId}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
            }}
            className={inputClass}
          >
            <option value={ALL}>{t('media.all')}</option>
            {owners.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            <option value={UNUSED}>{t('media.unused')}</option>
            <option value={NO_ALT}>{t('media.noAlt')}</option>
          </select>
        </div>
        <div className="gap-1 flex flex-col">
          <label htmlFor={searchId} className="text-sm text-neutral-600">
            {t('media.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
            className={inputClass}
          />
        </div>
      </div>

      {loadError && <p role="alert">{t('errors.loadFailed')}</p>}
      {!items && !loadError && <p>{t('list.loading')}</p>}
      {items && shown.length === 0 && <p className="text-neutral-500">{t('media.empty')}</p>}
      {shown.length > 0 && (
        <ul className="gap-4 sm:grid-cols-2 xl:grid-cols-3 grid">
          {shown.map((m) => (
            <MediaCard
              key={m.id}
              api={api}
              item={m}
              labelOf={labelOf}
              hrefOf={(ref) => `${base}/${ownerOf(config, ref).path}`}
              onChanged={(alt) => {
                setItems((list) => list?.map((i) => (i.id === m.id ? { ...i, alt } : i)) ?? null)
              }}
              onDeleted={() => {
                setItems((list) => list?.filter((i) => i.id !== m.id) ?? null)
              }}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

interface Asking {
  kind: 'blocked' | 'galleries' | 'plain'
  uses: MediaUses
}

function MediaCard({
  api,
  item,
  labelOf,
  hrefOf,
  onChanged,
  onDeleted,
}: {
  api: AdminApi
  item: AdminMedia
  labelOf: (ref: { type: string; slug: string }) => string
  hrefOf: (ref: { type: string; slug: string }) => string
  onChanged: (alt: string | null) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation('vefstjorn')
  const altId = useId()
  const [alt, setAlt] = useState(item.alt ?? '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)

  const labelWithTitle = (ref: MediaUseRef) =>
    ref.title ? `${labelOf(ref)}: ${ref.title}` : labelOf(ref)

  async function saveAlt() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.setAlt(item.id, alt)
      onChanged(alt.trim() || null)
      setSaved(true)
    } catch {
      setError(t('errors.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function askDelete() {
    setBusy(true)
    setError(null)
    try {
      const uses = await api.mediaUses(item.id)
      setAsking({
        kind: uses.image.length ? 'blocked' : uses.gallery.length ? 'galleries' : 'plain',
        uses,
      })
    } catch {
      setError(t('errors.loadFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api.removeMedia(item.id, asking?.kind === 'galleries')
      onDeleted()
    } catch (err) {
      // Someone put it in an image() field meanwhile: show why instead.
      const body = err instanceof ApiError ? (err.body as { uses?: MediaUses } | null) : null
      if (err instanceof ApiError && err.status === 409 && body?.uses) {
        setAsking({ kind: body.uses.image.length ? 'blocked' : 'galleries', uses: body.uses })
      } else setError(t('errors.deleteFailed'))
      setBusy(false)
    }
  }

  const uses = (refs: MediaUseRef[]) => (
    <ul className="pl-5 list-disc">
      {refs.map((r) => (
        <li key={`${r.type}/${r.slug}`}>
          <a href={hrefOf(r)} className="underline">
            {labelWithTitle(r)}
          </a>
        </li>
      ))}
    </ul>
  )

  return (
    <li aria-label={item.filename} className="gap-3 bg-white flex flex-col rounded-card p-tp">
      <img
        src={imageUrl(item.id, 480)}
        alt={item.alt ?? ''}
        width={item.width ?? undefined}
        height={item.height ?? undefined}
        loading="lazy"
        style={item.lqip ? { backgroundImage: `url(${item.lqip})`, backgroundSize: 'cover' } : {}}
        className="bg-neutral-100 aspect-[4/3] w-full rounded-img object-cover"
      />
      <p className="text-sm break-all">{item.filename}</p>
      <p className="text-sm text-neutral-600">
        {item.uses.length
          ? t('media.usedIn', {
              list: [...new Set(item.uses.map(labelOf))].join(', '),
            })
          : t('media.unused')}
      </p>

      <form
        className="gap-2 flex flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          void saveAlt()
        }}
      >
        <label htmlFor={altId} className="text-sm text-neutral-600">
          {t('media.alt')}
        </label>
        <input
          id={altId}
          value={alt}
          maxLength={300}
          onChange={(e) => {
            setAlt(e.target.value)
            setSaved(false)
          }}
          className={inputClass}
        />
        <div className="gap-3 flex flex-wrap items-center">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border-neutral-300 bg-white px-3 py-1.5 border disabled:opacity-60"
          >
            {t('media.saveAlt')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void askDelete()}
            className="rounded-lg px-3 py-1.5 text-red-700 hover:bg-red-50"
          >
            {t('actions.delete')}
          </button>
          <span role="status" className="text-sm text-neutral-500">
            {saved ? t('editor.saved') : ''}
          </span>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {asking?.kind === 'blocked' && (
        <div role="alert" className="gap-2 rounded-lg bg-amber-50 p-3 text-sm flex flex-col">
          <p>{t('media.blocked')}</p>
          {uses(asking.uses.image)}
          <button
            type="button"
            onClick={() => {
              setAsking(null)
            }}
            className="rounded-lg px-3 py-1.5 self-start"
          >
            {t('actions.close')}
          </button>
        </div>
      )}
      {asking && asking.kind !== 'blocked' && (
        <div role="alert" className="gap-2 rounded-lg bg-red-50 p-3 text-sm flex flex-col">
          {asking.kind === 'galleries' ? (
            <>
              <p>{t('media.confirmGalleries')}</p>
              {uses(asking.uses.gallery)}
            </>
          ) : (
            <p>{t('media.confirmDelete')}</p>
          )}
          <div className="gap-3 flex flex-wrap items-center">
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
                setAsking(null)
              }}
              className="rounded-lg px-3 py-1.5"
            >
              {t('actions.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
