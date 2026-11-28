import { vefstjornResources } from '@norduo/cms/admin'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import siteEn from '../locales/en/site.json'
import cmsIs from '../locales/is/cms.json'
import siteIs from '../locales/is/site.json'

/**
 * Namespaces: `site` (the public site's fixed strings, is + en), `cms` (content-model labels
 * for Vefstjórn, is only) and `vefstjorn` (the CMS's own strings). Text an editor would
 * reword lives in D1, not here.
 */
export const resources = {
  is: { site: siteIs, cms: cmsIs, vefstjorn: vefstjornResources.is },
  en: { site: siteEn },
} as const

/**
 * Bundled statically and initialised synchronously, so SSR never waits on a fetch.
 * A missing key renders as the key itself; it never throws.
 */
function instance(lng: keyof typeof resources) {
  const i18n = i18next.createInstance()
  void i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: false,
    defaultNS: 'site',
    ns: ['site', 'cms', 'vefstjorn'],
    initAsync: false,
    interpolation: { escapeValue: false },
  })
  return i18n
}

/** Icelandic: the public site at the root, and Vefstjórn. */
export const i18n = instance('is')

/**
 * One instance per locale, never `changeLanguage` on a shared one: a Worker renders
 * requests in both languages at once.
 */
const byLocale = { is: i18n, en: instance('en') }

export const i18nFor = (locale: string) => (locale === 'en' ? byLocale.en : byLocale.is)
