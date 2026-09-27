import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = 1_000_000_000_000
  it('says "just now" for recent times', () => expect(timeAgo(now / 1000 - 10, now)).toBe('just now'))
  it('uses minutes under an hour', () => expect(timeAgo(now / 1000 - 180, now)).toMatch(/3 min/))
  it('uses hours under a day', () => expect(timeAgo(now / 1000 - 7200, now)).toMatch(/2 hr/))
})
