import { describe, expect, it } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('lets later utilities override earlier ones', () => {
    expect(cn('flex h-9', 'hidden h-6 md:flex')).toBe('hidden h-6 md:flex')
    expect(cn('bg-[var(--accent)] text-white', 'bg-[#ff453a]')).toBe('text-white bg-[#ff453a]')
    expect(cn('bg-fill-control', 'bg-fill-active')).toBe('bg-fill-active')
  })
})
