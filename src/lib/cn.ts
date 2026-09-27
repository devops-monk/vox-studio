import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge our custom color tokens so e.g. `bg-fill-control` and `bg-[#ff453a]` conflict correctly.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { color: ['accent', 'text-1', 'text-2', 'text-3', 'hairline', 'fill-hover', 'fill-active', 'fill-control'] },
  },
})

/** Join class names; later Tailwind utilities override conflicting earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
