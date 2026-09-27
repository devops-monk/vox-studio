import type { NavItem } from '@/app/nav'
import { GlassPanel } from '@/components/glass'

/** Stand-in for a feature page until its milestone in plan.md lands. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <div className="mx-auto flex h-full max-w-3xl items-center justify-center p-8">
      <GlassPanel className="flex w-full flex-col items-center gap-3 px-10 py-14 text-center animate-[pop-in_260ms_var(--ease-spring)]">
        <div className="flex size-14 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
          <Icon size={26} strokeWidth={1.7} />
        </div>
        <h2 className="font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.02em]">{item.label}</h2>
        <p className="max-w-sm text-text-2">{item.description}</p>
        <span className="mt-2 rounded-full bg-fill-control px-2.5 py-0.5 text-[11px] font-medium text-text-2">
          Coming in {item.milestone}
        </span>
      </GlassPanel>
    </div>
  )
}
