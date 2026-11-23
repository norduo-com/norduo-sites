import type { ReactNode } from 'react'

import { SiteNav } from './SiteNav'

/**
 * The green box at the top of a page, with the menu in it, then the page's eyebrow,
 * heading and lead from Vefstjórn. The home page passes its own content instead.
 */
export function PageHeader({
  eyebrow,
  heading,
  lead,
  children,
}: {
  eyebrow?: string | undefined
  heading?: string | undefined
  lead?: string | undefined
  children?: ReactNode
}) {
  return (
    <header className="px-g pt-g">
      <div className="bg-panel text-white relative rounded-box pb-in">
        <SiteNav />
        {children ?? (
          <div className="gap-x-12 gap-y-5 flex flex-wrap items-end justify-between px-in pt-s2">
            <div>
              {eyebrow && <p className="eyebrow text-acc">{eyebrow}</p>}
              <h1 className="mt-3.5 max-w-3xl text-[clamp(40px,5vw,72px)] leading-[1.05]">
                {heading}
              </h1>
            </div>
            {lead && <p className="lead max-w-md text-white/80">{lead}</p>}
          </div>
        )}
      </div>
    </header>
  )
}
