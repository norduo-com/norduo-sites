import { useTranslation } from 'react-i18next'

import type { Badge, BadgeTone } from '../define'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-200 text-neutral-700',
  info: 'bg-sky-100 text-sky-900',
  success: 'bg-green-100 text-green-900',
  warning: 'bg-amber-100 text-amber-900',
}

/** A list row's tags from the collection's `list.badge` hook. */
export function Badges({ badges }: { badges: readonly Badge[] }) {
  const { t } = useTranslation('cms')
  if (badges.length === 0) return null
  return (
    <span className="gap-1 flex flex-wrap">
      {badges.map((b) => (
        <span key={b.label} className={`px-2 text-sm rounded-full ${TONES[b.tone ?? 'neutral']}`}>
          {t(b.label)}
        </span>
      ))}
    </span>
  )
}

/** The collection's `list.notice` banner, then its `warnings`. Keys are in the `cms` namespace. */
export function ListMessages({
  notice,
  warnings,
}: {
  notice?: string | null
  warnings: readonly string[]
}) {
  const { t } = useTranslation(['cms', 'vefstjorn'])
  return (
    <>
      {notice && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">{t(notice)}</p>}
      {warnings.length > 0 && (
        <ul aria-label={t('vefstjorn:warnings.label')} className="gap-1 flex flex-col">
          {warnings.map((w) => (
            <li key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              {t(w)}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** The side card from a `note: true` in the config: what can't be changed here, and why. */
export function Note({ text }: { text: string }) {
  const { t } = useTranslation('vefstjorn')
  return (
    <aside
      aria-label={t('note.label')}
      className="gap-3 bg-neutral-100 text-neutral-700 flex items-start rounded-card p-tp"
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="mt-0.5 shrink-0"
      >
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <p>{text}</p>
    </aside>
  )
}
