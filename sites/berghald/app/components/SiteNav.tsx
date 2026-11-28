import { useTranslation } from 'react-i18next'

import { useShell } from '~/shell'

import { Icon } from './Icon'
import { LanguageSwitch } from './LanguageSwitch'

/**
 * The menu at the top of every page's header box: logo, page links, the language switch and
 * "Fáðu tilboð". Below 1100 px the links fold into a menu that opens without JavaScript.
 */
export function SiteNav() {
  const { t } = useTranslation('site')
  const shell = useShell()
  const links = shell.menu.map((l) => (
    <a
      key={l.name}
      href={l.href}
      aria-current={shell.current(l.href) ? 'page' : undefined}
      className="py-1.5 decoration-1 underline-offset-8 hover:underline aria-[current=page]:underline"
    >
      {l.label}
    </a>
  ))
  return (
    <nav
      aria-label={t('nav.main')}
      className="gap-6 pt-6 relative z-10 flex items-center justify-between px-in"
    >
      <a
        href={shell.home}
        aria-label={t('nav.home')}
        className="text-2xl font-medium tracking-tight"
      >
        Berghald
      </a>
      <div className="gap-9 lg:flex hidden">{links}</div>
      <div className="gap-3 flex items-center">
        <LanguageSwitch />
        <a href={shell.quote} className="btn btn-acc btn-sm max-md:hidden">
          {t('nav.quote')}
        </a>
        <details className="group lg:hidden">
          <summary
            aria-label={t('nav.openMenu')}
            className="size-11 border-white/55 flex cursor-pointer list-none items-center justify-center rounded-full border [&::-webkit-details-marker]:hidden"
          >
            <span className="group-open:hidden">
              <Icon name="menu" />
            </span>
            <span className="hidden group-open:inline">
              <Icon name="close" />
            </span>
          </summary>
          <div className="bg-deep inset-x-0 mt-3 gap-4 text-3xl absolute top-full flex flex-col rounded-card p-in">
            {links}
            <a href={shell.quote} className="btn btn-acc text-base self-start">
              {t('nav.quote')}
            </a>
          </div>
        </details>
      </div>
    </nav>
  )
}
