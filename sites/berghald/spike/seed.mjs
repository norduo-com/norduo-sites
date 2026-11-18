// Generates seed SQL shaped like CMS documents: JSON blobs per row.
const words =
  'garður hellulögn hleðsla grjót torf gróður lóð frágangur kranabíll steinveggur pallur verönd stétt hiti snjóbræðsla beð tré runnar grasflöt drenlögn'.split(
    ' ',
  )
let seed = 1
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const text = (n) =>
  Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ')
const blur =
  'data:image/webp;base64,' +
  'UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoQAAsAAUAmJaQAA3AA/v89WAAAAA'.repeat(12)
const img = (k) => ({ key: `projects/${k}.jpg`, alt: text(6), w: 2400, h: 1600, blur })
const esc = (s) => s.replace(/'/g, "''")
const rows = []
const doc = (coll, slug, data) =>
  rows.push(`('${coll}','${slug}','published','${esc(JSON.stringify(data))}',${Date.now()})`)

doc('pages', 'forsida', {
  header: {
    title: 'Við mótum lóðina þína',
    kicker: text(4),
    lead: text(30),
    ctas: [
      { label: 'Fá tilboð', href: '/tilbod' },
      { label: 'Verkin okkar', href: '/verk' },
    ],
    cover: img('hero'),
  },
  seo: { title: 'Berghald', description: text(25) },
  blocks: [
    {
      type: 'stats',
      items: Array.from({ length: 4 }, (_, i) => ({
        value: String(100 * (i + 1)),
        label: text(3),
      })),
    },
    {
      type: 'process',
      title: text(4),
      steps: Array.from({ length: 5 }, () => ({ title: text(3), body: text(35) })),
    },
    {
      type: 'crane',
      title: 'Kranabíll',
      body: text(60),
      specs: Array.from({ length: 8 }, () => ({ k: text(2), v: text(2) })),
      image: img('crane'),
    },
    {
      type: 'testimonials',
      items: Array.from({ length: 4 }, () => ({ quote: text(40), name: text(2), place: text(1) })),
    },
    { type: 'faq', items: Array.from({ length: 8 }, () => ({ q: text(8) + '?', a: text(50) })) },
    { type: 'cta', title: text(5), body: text(20) },
  ],
})
for (let i = 0; i < 6; i++)
  doc('services', `thjonusta-${i}`, {
    title: text(2),
    summary: text(40),
    body: text(150),
    image: img(`s${i}`),
    order: i,
  })
for (let i = 0; i < 12; i++)
  doc('projects', `verk-${i}`, {
    title: text(3),
    place: text(1),
    year: 2018 + (i % 8),
    tags: [text(1), text(1), text(1)],
    summary: text(30),
    cover: img(`p${i}`),
    gallery: Array.from({ length: 10 }, (_, j) => img(`p${i}-${j}`)),
    featured: i < 8,
  })
doc('settings', 'site', {
  phone: '000 0000',
  email: 'x@example.com',
  nav: Array.from({ length: 8 }, (_, i) => ({ label: text(1), href: `/s${i}` })),
  footer: Array.from({ length: 20 }, (_, i) => ({ label: text(2), href: `/f${i}` })),
})

console.log(`drop table if exists documents;
create table documents (collection text not null, slug text not null, status text not null, data text not null, updated_at integer not null, primary key (collection, slug));
${rows.map((r) => `insert into documents values ${r};`).join('\n')}`)
