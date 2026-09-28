import { GlassPanel } from '@/components/glass'

export function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-[12px] text-text-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Group({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">{title}</h3>}
      <GlassPanel className="divide-y-[0.5px] divide-[var(--hairline)]">{children}</GlassPanel>
      {footer && <p className="px-1 text-[11px] text-text-3">{footer}</p>}
    </section>
  )
}

export function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-7 max-w-56 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}
