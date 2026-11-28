import { localeOfPath } from '@norduo/cms'
import { useLocation } from 'react-router'

import cms from '../cms.config'

/** The locale comes from the path: Icelandic at the root, English under /en. */
export function useLocale() {
  return localeOfPath(cms, useLocation().pathname)
}

/** The locale of a loader's request. */
export const localeOf = (request: Request) => localeOfPath(cms, new URL(request.url).pathname)
