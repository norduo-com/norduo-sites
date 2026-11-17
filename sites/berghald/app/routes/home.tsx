import { CallButton } from '~/components/CallButton'

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

export default function Home() {
  return (
    <main className="flex flex-col gap-s p-g">
      <section className="bg-neutral-900 text-white rounded-box p-in">
        <p className="text-sm tracking-widest uppercase">Lóðafrágangur · Hellulagnir · Hleðslur</p>
        <h1 className="mt-4 text-5xl">Við mótum lóðina þína</h1>
      </section>
      <CallButton phone="691 8944" />
    </main>
  )
}
