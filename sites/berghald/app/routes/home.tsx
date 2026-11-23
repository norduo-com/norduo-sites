import { seoMeta } from '@norduo/cms'
import { getPage, listPublished, mediaByIds } from '@norduo/cms/server'
import { useTranslation } from 'react-i18next'

import { CallButton } from '~/components/CallButton'
import { PageHeader } from '~/components/PageHeader'
import { Photo } from '~/components/Photo'
import { cloudflare } from '~/context'
import { localeOf } from '~/locale'
import { headTags } from '~/seo'

import cms from '../../cms.config'
import type { Route } from './+types/home'

export function meta({ loaderData }: Route.MetaArgs) {
  return loaderData.head
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare)
  const locale = localeOf(request)
  const [page, items] = await Promise.all([
    getPage(env.DB, cms, 'home', { locale }),
    listPublished(env.DB, cms, 'equipment', { fields: ['name', 'description', 'photo'], locale }),
  ])
  const media = await mediaByIds(
    env.DB,
    items.flatMap((i) => (i.data.photo ? [i.data.photo.mediaId] : [])),
  )
  const equipment = items.map(({ slug, data: { photo, ...data } }) => ({
    slug,
    data,
    photo: photo ? (media.get(photo.mediaId) ?? null) : null,
  }))
  const head = headTags(
    seoMeta(cms.pages.home.seo, page ?? {}, { siteName: cms.site.name }),
    new URL(request.url),
  )
  // Only the header goes to the browser, not the whole page.
  const header = page && { eyebrow: page.eyebrow, heading: page.heading, lead: page.lead }
  return { head, header, equipment }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation('site')
  const { header } = loaderData
  return (
    <>
      {/* Until the header is filled in in Vefstjórn, the prototype's hero text stands in. */}
      <PageHeader>
        <div className="max-w-2xl gap-5 flex flex-col px-in pt-s">
          <p className="eyebrow">{header?.eyebrow ?? t('home.eyebrow')}</p>
          <h1 className="text-[clamp(42px,5.4vw,80px)] leading-[1.04]">
            {header?.heading ?? t('home.heading')}
          </h1>
          {header?.lead && <p className="lead text-white/80">{header.lead}</p>}
        </div>
      </PageHeader>
      <main id="main" className="flex flex-col gap-s px-g pt-s">
        <CallButton phone="691 8944" />
        {loaderData.equipment.length > 0 && (
          <section aria-labelledby="equipment-heading">
            <h2 id="equipment-heading" className="text-3xl">
              {t('equipment.heading')}
            </h2>
            <ul className="md:grid-cols-3 mt-s2 grid gap-grid">
              {loaderData.equipment.map(({ slug, data, photo }) => (
                <li key={slug} className="bg-white rounded-card p-cp">
                  {photo && (
                    <Photo
                      media={photo}
                      sizes="(min-width: 768px) 33vw, 100vw"
                      className="mb-4 aspect-4/3 w-full rounded-img object-cover"
                    />
                  )}
                  <h3 className="text-xl">{data.name}</h3>
                  {data.description && <p className="mt-2 text-neutral-600">{data.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  )
}
