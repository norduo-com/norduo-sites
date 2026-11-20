import { listPublished, mediaByIds } from '@norduo/cms/server'
import { useTranslation } from 'react-i18next'

import { CallButton } from '~/components/CallButton'
import { Photo } from '~/components/Photo'
import { cloudflare } from '~/context'

import cms from '../../cms.config'
import type { Route } from './+types/home'

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Berghald – lóðafrágangur, hellulagnir og hleðslur' },
    {
      name: 'description',
      content: 'Berghald skapar nýja garða og gefur eldri görðum nýtt líf.',
    },
  ]
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflare)
  const items = await listPublished(env.DB, cms, 'equipment', {
    fields: ['name', 'description', 'photo'],
  })
  const media = await mediaByIds(
    env.DB,
    items.flatMap((i) => (i.data.photo ? [i.data.photo.mediaId] : [])),
  )
  const equipment = items.map(({ slug, data: { photo, ...data } }) => ({
    slug,
    data,
    photo: photo ? (media.get(photo.mediaId) ?? null) : null,
  }))
  return { equipment }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation('site')
  return (
    <main className="flex flex-col gap-s p-g">
      <section className="bg-neutral-900 text-white rounded-box p-in">
        <p className="text-sm tracking-widest uppercase">Lóðafrágangur · Hellulagnir · Hleðslur</p>
        <h1 className="mt-4 text-5xl">Við mótum lóðina þína</h1>
      </section>
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
                    className="mb-4 aspect-[4/3] w-full rounded-img object-cover"
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
  )
}
