import { useId } from 'react'
import { cn } from '@/lib/cn'

interface Props {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
  /** Labels under the track's ends, e.g. ["Flat", "Dramatic"]. */
  ends?: [string, string]
  disabled?: boolean
  hint?: string
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format, ends, disabled, hint }: Props) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('space-y-1.5', disabled && 'opacity-40')}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] font-medium text-text-1">
          {label}
        </label>
        <span className="text-[11px] tabular-nums text-text-2">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="vox-range w-full"
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {ends && (
        <div className="flex justify-between text-[10px] text-text-3">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-[11px] text-text-3">
          {hint}
        </p>
      )}
    </div>
  )
}
