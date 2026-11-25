import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { canBeCover, coverIndex, type GalleryItem, parseVideoLink } from '../gallery'
import { imageUrl, videoUrl } from '../media'
import { useAdmin } from './context'
import { inputClass } from './styles'
import {
  IMAGE_ACCEPT,
  UploadError,
  type UploadErrorCode,
  uploadImage,
  uploadVideo,
  VIDEO_ACCEPT,
} from './upload'

interface Failure {
  code: UploadErrorCode | 'link'
  detail?: string
}

const failureOf = (err: unknown): Failure =>
  err instanceof UploadError ? { code: err.code, detail: err.detail } : { code: 'failed' }

const button = 'rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-60'
const small = 'rounded-lg px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40'

/**
 * A gallery: photos, MP4 videos and YouTube/Vimeo links in order, one of them the cover.
 * Uploads start on pick; photos go one at a time.
 */
export function GalleryInput({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
}) {
  const { api } = useAdmin()
  const { t } = useTranslation('vefstjorn')
  const items = Array.isArray(value) ? (value as GalleryItem[]) : []
  // Uploads finish after renders; each adds to the newest list, not the one it started with.
  const latest = useRef(items)
  useEffect(() => {
    latest.current = Array.isArray(value) ? (value as GalleryItem[]) : []
  }, [value])

  const photos = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLInputElement>(null)
  const poster = useRef<HTMLInputElement>(null)
  const [posterFor, setPosterFor] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)
  const [link, setLink] = useState('')

  const set = (next: GalleryItem[]) => {
    latest.current = next
    onChange(next.length ? next : undefined)
  }
  const update = (index: number, change: (item: GalleryItem) => GalleryItem) => {
    set(latest.current.map((item, i) => (i === index ? change(item) : item)))
  }

  // One upload at a time, even if a file input fires while its button is disabled.
  const running = useRef(false)
  async function run(task: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(failureOf(err))
    } finally {
      running.current = false
      setBusy(null)
    }
  }

  const addPhotos = (files: File[]) =>
    run(async () => {
      let failure: Failure | null = null
      for (const [i, file] of files.entries()) {
        setBusy(t('gallery.uploadingPhotos', { n: i + 1, count: files.length }))
        try {
          const media = await uploadImage(api, file)
          set([...latest.current, { kind: 'image', mediaId: media.id }])
        } catch (err) {
          failure = failureOf(err)
        }
      }
      if (failure) setError(failure)
    })

  const addVideo = (file: File) =>
    run(async () => {
      setBusy(t('gallery.uploadingVideo', { percent: 0 }))
      const { media, frame } = await uploadVideo(api, file, (share) => {
        setBusy(t('gallery.uploadingVideo', { percent: Math.round(share * 100) }))
      })
      // A still from the video becomes its poster; without one, the editor can pick a photo.
      let poster: { mediaId: string } | undefined
      if (frame) {
        setBusy(t('gallery.makingPoster'))
        poster = await uploadImage(api, frame).then(
          (m) => ({ mediaId: m.id }),
          () => undefined,
        )
      }
      set([...latest.current, { kind: 'video', mediaId: media.id, ...(poster && { poster }) }])
    })

  const addPoster = (index: number, file: File) =>
    run(async () => {
      setBusy(t('image.uploading'))
      const media = await uploadImage(api, file)
      update(index, (item) =>
        item.kind === 'video' ? { ...item, poster: { mediaId: media.id } } : item,
      )
    })

  function addLink() {
    if (!parseVideoLink(link)) {
      setError({ code: 'link' })
      return
    }
    setError(null)
    set([...latest.current, { kind: 'embed', url: link.trim() }])
    setLink('')
  }

  const move = (from: number, to: number) => {
    const next = [...latest.current]
    const [item] = next.splice(from, 1)
    if (!item) return
    next.splice(to, 0, item)
    set(next)
  }

  const setCover = (index: number) => {
    set(
      latest.current.map((item, i) => {
        if (item.kind === 'embed') return item
        const { cover: _, ...rest } = item
        return i === index ? { ...rest, cover: true } : rest
      }),
    )
  }

  const cover = coverIndex(items)
  const working = busy !== null

  return (
    <div className="gap-3 flex flex-col">
      {items.length > 0 && (
        <ol className="gap-3 flex flex-col">
          {items.map((item, i) => {
            const n = i + 1
            const key = item.kind === 'embed' ? `${item.url}-${String(i)}` : item.mediaId
            return (
              <li
                key={key}
                className="gap-3 rounded-lg border-neutral-200 p-3 flex flex-wrap items-start border"
              >
                <Preview item={item} />
                <div className="gap-2 min-w-0 flex flex-1 flex-col items-start">
                  <span className="text-sm text-neutral-500">
                    {t(`gallery.kind.${item.kind}`, { n })}
                  </span>
                  {item.kind === 'embed' && <span className="text-sm break-all">{item.url}</span>}
                  {item.kind !== 'embed' && (
                    <label className="gap-2 text-sm flex items-center">
                      <input
                        type="radio"
                        name={`${id}-cover`}
                        checked={cover === i}
                        disabled={!canBeCover(item) || working}
                        onChange={() => {
                          setCover(i)
                        }}
                      />
                      {t('gallery.cover')}
                      {item.kind === 'video' && !item.poster && (
                        <span className="text-neutral-500">{t('gallery.coverNeedsPoster')}</span>
                      )}
                    </label>
                  )}
                  {item.kind === 'video' && (
                    <div className="gap-2 flex flex-wrap">
                      <button
                        type="button"
                        className={small}
                        disabled={working}
                        onClick={() => {
                          setPosterFor(i)
                          poster.current?.click()
                        }}
                      >
                        {item.poster ? t('gallery.replacePoster') : t('gallery.choosePoster')}
                      </button>
                      {item.poster && (
                        <button
                          type="button"
                          className={small}
                          disabled={working}
                          onClick={() => {
                            update(i, (it) => {
                              if (it.kind !== 'video') return it
                              const { poster: _p, cover: _c, ...rest } = it
                              return rest
                            })
                          }}
                        >
                          {t('gallery.removePoster')}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="gap-1 flex flex-wrap">
                    <button
                      type="button"
                      className={small}
                      disabled={i === 0 || working}
                      aria-label={t('gallery.moveUpItem', { n })}
                      onClick={() => {
                        move(i, i - 1)
                      }}
                    >
                      {t('gallery.moveUp')}
                    </button>
                    <button
                      type="button"
                      className={small}
                      disabled={i === items.length - 1 || working}
                      aria-label={t('gallery.moveDownItem', { n })}
                      onClick={() => {
                        move(i, i + 1)
                      }}
                    >
                      {t('gallery.moveDown')}
                    </button>
                    <button
                      type="button"
                      className={`${small} text-red-700 hover:bg-red-50`}
                      disabled={working}
                      aria-label={t('gallery.removeItem', { n })}
                      onClick={() => {
                        set(latest.current.filter((_, at) => at !== i))
                      }}
                    >
                      {t('gallery.remove')}
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <input
        ref={photos}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('gallery.addPhotos')}
        disabled={working}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void addPhotos(files)
        }}
      />
      <input
        ref={video}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('gallery.addVideo')}
        disabled={working}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void addVideo(file)
        }}
      />
      <input
        ref={poster}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('gallery.choosePoster')}
        disabled={working}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && posterFor !== null) void addPoster(posterFor, file)
        }}
      />
      <div className="gap-3 flex flex-wrap items-center">
        <button
          type="button"
          className={button}
          disabled={working}
          onClick={() => photos.current?.click()}
        >
          {t('gallery.addPhotos')}
        </button>
        <button
          type="button"
          className={button}
          disabled={working}
          onClick={() => video.current?.click()}
        >
          {t('gallery.addVideo')}
        </button>
        <span aria-live="polite" className="text-sm text-neutral-500">
          {busy ?? ''}
        </span>
      </div>
      <div className="gap-2 flex flex-wrap items-end">
        <label className="gap-1 flex flex-col">
          <span className="text-sm">{t('gallery.link')}</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            className={`${inputClass} w-80 max-w-full`}
            placeholder="https://www.youtube.com/watch?v=…"
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink()
              }
            }}
          />
        </label>
        <button type="button" className={button} disabled={!link.trim()} onClick={addLink}>
          {t('gallery.addLink')}
        </button>
      </div>
      <p className="text-sm text-neutral-500">{t('gallery.help')}</p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error.code === 'link' || error.code.startsWith('video')
            ? t(`gallery.errors.${error.code}`)
            : t(`image.errors.${error.code}`)}
          {error.detail && (
            <span className="text-xs text-neutral-500 block">
              {t('image.errorDetail', { detail: error.detail })}
            </span>
          )}
        </p>
      )}
    </div>
  )
}

const thumb = 'w-40 bg-neutral-100 aspect-[4/3] rounded-img object-cover'

function Preview({ item }: { item: GalleryItem }) {
  const { t } = useTranslation('vefstjorn')
  if (item.kind === 'image')
    return <img src={imageUrl(item.mediaId, 480)} alt="" className={thumb} />
  if (item.kind === 'video') {
    return item.poster ? (
      <img src={imageUrl(item.poster.mediaId, 480)} alt="" className={thumb} />
    ) : (
      <video src={`${videoUrl(item.mediaId)}#t=0.1`} preload="metadata" muted className={thumb} />
    )
  }
  const provider = parseVideoLink(item.url)?.provider
  return (
    <div className={`${thumb} text-sm text-neutral-600 flex items-center justify-center`}>
      {provider ? t(`gallery.provider.${provider}`) : t('gallery.kind.embed', { n: '' })}
    </div>
  )
}
