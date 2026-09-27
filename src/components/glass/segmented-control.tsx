import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
}

interface Props<T extends string> {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  'aria-label'?: string
}

export function SegmentedControl<T extends string>({ value, options, onChange, ...rest }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className="no-drag inline-flex shrink-0 rounded-[8px] bg-fill-control p-0.5">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-6 whitespace-nowrap rounded-[6px] px-3 text-[12px] font-medium transition-all duration-200 ease-[var(--ease-spring)]',
              active ? 'bg-[var(--glass-3)] text-text-1 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_0.5px_var(--hairline)]' : 'text-text-2 hover:text-text-1',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
