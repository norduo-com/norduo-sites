import { useTranslation } from 'react-i18next'

import { telHref, useShell } from '~/shell'

import { Icon } from './Icon'

/**
 * The CTA box (if its heading is filled in) and the dark footer: the footer text, the menu,
 * contact details from Stillingar, and the legal line with the privacy and cookie pages.
 */
export function Footer() {
  const { t } = useTranslation('site')
  const shell = useShell()
  const { footer, settings } = shell
  const cta = footer?.cta
  return (
    <>
      {cta?.heading && (
        <section className="mt-s px-g">
          <div className="bg-deep gap-6 text-white flex flex-wrap items-end justify-between rounded-box p-in">
            <h2 className="h2 max-w-2xl">{cta.heading}</h2>
            <a href={shell.quote} className="btn btn-acc">
              {cta.button ?? t('nav.quote')} <Icon name="arrow" />
            </a>
          </div>
        </section>
      )}
      <footer className="bg-ink pb-7 text-white mx-g mt-s2 rounded-box px-in pt-in">
        <div className="gap-x-12 gap-y-8 flex flex-wrap items-start">
          {footer?.text && (
            <p className="leading-tight flex-[1_1_280px] text-[clamp(26px,2.6vw,36px)] whitespace-pre-line">
              {footer.text}
            </p>
          )}
          <div className="gap-12 flex flex-wrap">
            <div>
              <h2 className="footer-heading">{t('footer.pages')}</h2>
              <ul className="gap-2.5 flex flex-col">
                {shell.menu.map((l) => (
                  <li key={l.name}>
                    <a href={l.href} className="hover:text-acc">
                      {l.label}
                    </a>
                  </li>
                ))}
                <li>
                  <a href={shell.quote} className="hover:text-acc">
                    {t('nav.quote')}
                  </a>
                </li>
              </ul>
            </div>
            {[settings?.phone, settings?.email].some(Boolean) && settings && (
              <div>
                <h2 className="footer-heading">{t('footer.contact')}</h2>
                <ul className="gap-2.5 flex flex-col">
                  {settings.phone && (
                    <li>
                      <a
                        href={telHref(settings.phone)}
                        className="gap-2.5 hover:text-acc flex items-center"
                      >
                        <Icon name="phone" size={16} />
                        {settings.phone}
                      </a>
                    </li>
                  )}
                  {settings.email && (
                    <li>
                      <a
                        href={`mailto:${settings.email}`}
                        className="gap-2.5 hover:text-acc flex items-center"
                      >
                        <Icon name="mail" size={16} />
                        {settings.email}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="gap-x-6 gap-y-3 border-white/15 pt-5 text-sm text-white/60 mt-s2 flex flex-wrap justify-between border-t">
          {settings?.company && (
            <span>
              © {new Date().getFullYear()} {settings.company}
              {settings.kennitala && ` · ${t('footer.kennitala')} ${settings.kennitala}`}
            </span>
          )}
          <nav aria-label={t('footer.legal')} className="gap-x-6 gap-y-2 flex flex-wrap">
            {shell.legal.map((l) => (
              <a key={l.name} href={l.href} className="hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </>
  )
}
