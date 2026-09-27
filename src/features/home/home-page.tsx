import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { NAV } from '@/app/nav'
import { TryVoice } from './try-voice'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function HomePage() {
  // Studio is represented by the Try-a-voice card above.
  const create = (NAV.find((s) => s.title === 'Create')?.items ?? []).filter((i) => i.path !== '/studio')
  const library = NAV.find((s) => s.title === 'Library')?.items ?? []

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-8 py-8">
      <section className="space-y-1">
        <h2 className="font-[var(--font-display)] text-[28px] font-bold tracking-[-0.025em]">{greeting()}</h2>
        <p className="text-[14px] text-text-2">What do you want to make today?</p>
      </section>

      <TryVoice />

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {create.map((item, i) => (
          <Link
            key={item.path}
            to={item.path}
            style={{ animationDelay: `${i * 30}ms` }}
            className="glass group relative flex flex-col gap-3 rounded-[var(--radius-lg)] p-4 animate-[pop-in_320ms_var(--ease-spring)_both] transition-transform duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5"
          >
            <div className="flex size-9 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
              <item.icon size={18} strokeWidth={1.8} />
            </div>
            <div>
              <div className="text-[14px] font-semibold">{item.label}</div>
              <div className="text-[12px] text-text-2">{item.description}</div>
            </div>
            <ArrowUpRight size={14} className="absolute right-3 top-3 text-text-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-[12px] font-semibold tracking-wide text-text-3">Library</h3>
        <div className="glass divide-y-[0.5px] divide-[var(--hairline)] overflow-hidden rounded-[var(--radius-lg)]">
          {library.map((item) => (
            <Link key={item.path} to={item.path} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill-hover">
              <item.icon size={16} strokeWidth={1.8} className="text-text-2" />
              <span className="font-medium">{item.label}</span>
              <span className="truncate text-text-3">{item.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
