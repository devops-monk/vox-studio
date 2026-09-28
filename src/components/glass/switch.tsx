import { cn } from '@/lib/cn'

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('no-drag relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-[#30d158]' : 'bg-fill-active')}
    >
      <span
        className={cn(
          'absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-[var(--ease-spring)]',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}
