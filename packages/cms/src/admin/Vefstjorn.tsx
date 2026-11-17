import type { CmsConfig } from '../define'

/**
 * Admin shell. Screens are generated from the site's config:
 * one list + edit screen per collection, one form per singleton.
 * Placeholder until the screens from the prototype are ported.
 */
export function Vefstjorn({ config }: { config: CmsConfig }) {
  const items = [
    ...Object.entries(config.collections).map(([id, c]) => ({ id, label: c.label })),
    ...Object.entries(config.singletons ?? {}).map(([id, s]) => ({ id, label: s.label })),
    { id: 'myndasafn', label: 'Myndasafn' },
  ]

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Vefstjórn"
        className="w-64 gap-1 bg-neutral-900 p-4 text-white flex flex-col"
      >
        <p className="mb-4 text-sm tracking-widest uppercase">
          {config.admin?.title ?? 'Vefstjórn'}
        </p>
        {items.map((item) => (
          <a key={item.id} href={`#${item.id}`} className="rounded-lg px-3 py-2 hover:bg-white/10">
            {item.label}
          </a>
        ))}
      </nav>
      <main className="p-8 flex-1">
        <h1 className="text-3xl">{config.site.name}</h1>
      </main>
    </div>
  )
}
