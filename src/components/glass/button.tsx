import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'icon'

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0.5px_0_rgba(255,255,255,0.35)_inset,0_1px_2px_rgba(0,0,0,0.15)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-fill-control text-text-1 border-[0.5px] border-hairline hover:bg-fill-hover active:bg-fill-active',
  ghost: 'text-text-2 hover:bg-fill-hover hover:text-text-1 active:bg-fill-active',
}

const sizes: Record<Size, string> = {
  sm: 'h-6 px-2.5 text-[12px] rounded-[var(--radius-sm)]',
  md: 'h-8 px-3.5 text-[13px] rounded-[var(--radius-md)]',
  icon: 'size-7 rounded-[var(--radius-sm)] justify-center',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'no-drag inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-medium transition-[background,filter,color] duration-150 disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
