import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ImageValue } from '../fields'
import { imageUrl } from '../media'
import { useAdmin } from './context'
import { IMAGE_ACCEPT, UploadError, type UploadErrorCode, uploadImage } from './upload'

/** One photo: pick a file, see it, replace or remove it. The upload starts on pick. */
export function ImageInput({
  id,
  describedBy,
  invalid,
  value,
  onChange,
}: {
  id: string
  describedBy?: string
  invalid: boolean
  value: unknown
  onChange: (value: unknown) => void
}) {
  const { api } = useAdmin()
  const { t } = useTranslation('vefstjorn')
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UploadErrorCode | null>(null)
  const current = value as ImageValue | undefined

  async function pick(file: File) {
    setBusy(true)
    setError(null)
    try {
      const media = await uploadImage(api, file)
      onChange({ ...current, mediaId: media.id })
    } catch (err) {
      setError(err instanceof UploadError ? err.code : 'failed')
    } finally {
      setBusy(false)
    }
  }

  const button = 'rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-60'
  return (
    <div className="gap-2 flex flex-col items-start">
      {current && (
        <img
          src={imageUrl(current.mediaId, 480)}
          alt={t('image.preview')}
          className="w-60 bg-neutral-100 aspect-[4/3] rounded-img object-cover"
        />
      )}
      <input
        ref={picker}
        id={id}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        disabled={busy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void pick(file)
        }}
      />
      <div className="gap-3 flex flex-wrap items-center">
        <button
          type="button"
          disabled={busy}
          className={button}
          onClick={() => picker.current?.click()}
        >
          {current ? t('image.replace') : t('image.choose')}
        </button>
        {current && !busy && (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-red-700 hover:bg-red-50"
            onClick={() => {
              onChange(undefined)
            }}
          >
            {t('image.remove')}
          </button>
        )}
        <span aria-live="polite" className="text-sm text-neutral-500">
          {busy ? t('image.uploading') : ''}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`image.errors.${error}`)}
        </p>
      )}
    </div>
  )
}
