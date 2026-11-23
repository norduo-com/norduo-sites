import { useTranslation } from 'react-i18next'

import { useShell } from '~/shell'

import { Icon } from './Icon'

/**
 * A plain link to the same page in the other language, query string kept, so it works
 * without JavaScript. The choice isn't remembered.
 */
export function LanguageSwitch() {
  const { t } = useTranslation('site')
  const { switchTo } = useShell()
  return (
    <a
      href={switchTo.href}
      hrefLang={switchTo.locale}
      lang={switchTo.locale}
      aria-label={t('language.switch')}
      className="h-11 gap-2 border-white/55 px-4 hover:bg-white hover:text-ink flex items-center rounded-full border text-[15px]"
    >
      <Icon name="globe" />
      <span>{t('language.short')}</span>
    </a>
  )
}
