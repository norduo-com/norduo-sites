// THROWAWAY SPIKE: a Forsíða-sized page with data from D1, to measure SSR CPU time.
// Query params: x=<n> repeats the body n times; lean=1 drops galleries in SQL.
/* eslint-disable */
import { env } from 'cloudflare:workers'

import type { Route } from './+types/spike'

type Img = { key: string; alt: string; w: number; h: number; blur: string }
const WIDTHS = [480, 960, 1600, 2400]

function Picture({ img, sizes }: { img: Img; sizes: string }) {
  return (
    <img
      src={`/img/960/${img.key}`}
      srcSet={WIDTHS.map((w) => `/img/${w}/${img.key} ${w}w`).join(', ')}
      sizes={sizes}
      width={img.w}
      height={img.h}
      alt={img.alt}
      loading="lazy"
      style={{ backgroundImage: `url(${img.blur})`, backgroundSize: 'cover' }}
      className="h-auto w-full rounded-img"
    />
  )
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const lean = url.searchParams.get('lean') === '1'
  const burn = Number(url.searchParams.get('burn') ?? 0)
  if (burn) {
    let h = 0
    for (let i = 0; i < burn * 1e5; i++) h = (h * 31 + i) | 0
    if (h === 42) console.log(h)
  }
  const db = env.DB
  const col = lean ? "json_remove(data, '$.gallery')" : 'data'
  const [page, services, projects, settings] = await db.batch<{ data: string }>([
    db.prepare("select data from documents where collection='pages' and slug='forsida'"),
    db.prepare("select data from documents where collection='services' and status='published'"),
    db.prepare(
      `select ${col} as data from documents where collection='projects' and status='published'`,
    ),
    db.prepare("select data from documents where collection='settings' and slug='site'"),
  ])
  const parse = (r: D1Result<{ data: string }>) => r.results.map((x) => JSON.parse(x.data))
  return {
    x: Math.min(Number(url.searchParams.get('x') ?? 1), 10),
    page: parse(page)[0],
    services: parse(services).sort((a: any, b: any) => a.order - b.order),
    projects: parse(projects).filter((p: any) => p.featured),
    settings: parse(settings)[0],
  }
}

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: data.page.seo.title },
    { name: 'description', content: data.page.seo.description },
  ]
}

function Block({ b }: { b: any }) {
  switch (b.type) {
    case 'stats':
      return (
        <section className="md:grid-cols-4 grid grid-cols-2 gap-grid">
          {b.items.map((s: any, i: number) => (
            <div key={i} className="bg-white rounded-card p-cp">
              <p className="text-4xl">{s.value}</p>
              <p className="text-sm">{s.label}</p>
            </div>
          ))}
        </section>
      )
    case 'process':
      return (
        <section>
          <h2 className="text-3xl">{b.title}</h2>
          <ol className="md:grid-cols-5 mt-s2 grid gap-grid">
            {b.steps.map((s: any, i: number) => (
              <li key={i} className="bg-white rounded-card p-cp">
                <span>{String(i + 1).padStart(2, '0')}</span>
                <h3 className="text-xl">{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )
    case 'crane':
      return (
        <section className="md:grid-cols-2 grid gap-grid">
          <div>
            <h2 className="text-3xl">{b.title}</h2>
            <p>{b.body}</p>
            <table>
              <tbody>
                {b.specs.map((s: any, i: number) => (
                  <tr key={i}>
                    <th>{s.k}</th>
                    <td>{s.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Picture img={b.image} sizes="(min-width: 768px) 50vw, 100vw" />
        </section>
      )
    case 'testimonials':
      return (
        <section className="md:grid-cols-2 grid gap-grid">
          {b.items.map((t: any, i: number) => (
            <figure key={i} className="bg-white rounded-card p-cp">
              <blockquote>{t.quote}</blockquote>
              <figcaption>
                {t.name}, {t.place}
              </figcaption>
            </figure>
          ))}
        </section>
      )
    case 'faq':
      return (
        <section>
          {b.items.map((f: any, i: number) => (
            <details key={i} className="bg-white mt-s2 rounded-card p-cp">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      )
    case 'cta':
      return (
        <section className="bg-neutral-900 text-white rounded-box p-in">
          <h2 className="text-3xl">{b.title}</h2>
          <p>{b.body}</p>
          <a href="/tilbod" className="bg-white text-black rounded-card p-cp">
            Fá tilboð
          </a>
        </section>
      )
    default:
      return null
  }
}

function Body({ data }: { data: Route.ComponentProps['loaderData'] }) {
  const { page, services, projects } = data
  return (
    <>
      <section className="bg-neutral-900 text-white rounded-box p-in">
        <p className="text-sm uppercase">{page.header.kicker}</p>
        <h1 className="text-5xl">{page.header.title}</h1>
        <p>{page.header.lead}</p>
        {page.header.ctas.map((c: any) => (
          <a key={c.href} href={c.href} className="rounded-card p-cp">
            {c.label}
          </a>
        ))}
        <Picture img={page.header.cover} sizes="100vw" />
      </section>
      <section className="md:grid-cols-3 grid gap-grid">
        {services.map((s: any) => (
          <article key={s.title} className="bg-white rounded-card p-cp">
            <Picture img={s.image} sizes="(min-width: 768px) 33vw, 100vw" />
            <h3 className="text-xl">{s.title}</h3>
            <p>{s.summary}</p>
          </article>
        ))}
      </section>
      <section className="md:grid-cols-4 grid gap-grid">
        {projects.map((p: any) => (
          <a key={p.title} href={`/verk/${p.title}`} className="bg-white rounded-card p-cp">
            <Picture img={p.cover} sizes="(min-width: 768px) 25vw, 100vw" />
            <h3>{p.title}</h3>
            <p>
              {p.place} · {p.year}
            </p>
            <ul className="flex gap-grid">
              {p.tags.map((t: string) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </a>
        ))}
      </section>
      {page.blocks.map((b: any, i: number) => (
        <Block key={i} b={b} />
      ))}
    </>
  )
}

export default function Spike({ loaderData }: Route.ComponentProps) {
  const { settings, x } = loaderData
  return (
    <>
      <header className="flex gap-grid p-g">
        <a href="/">Berghald</a>
        <nav>
          {settings.nav.map((n: any) => (
            <a key={n.href} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <a href="/en">EN</a>
      </header>
      <main className="flex flex-col gap-s p-g">
        {Array.from({ length: x }, (_, i) => (
          <Body key={i} data={loaderData} />
        ))}
      </main>
      <footer className="grid grid-cols-4 gap-grid p-g">
        {settings.footer.map((f: any) => (
          <a key={f.href} href={f.href}>
            {f.label}
          </a>
        ))}
        <p>
          {settings.phone} · {settings.email}
        </p>
      </footer>
    </>
  )
}
