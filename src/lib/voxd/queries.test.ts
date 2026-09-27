import { describe, expect, it } from 'vitest'
import { newer } from './queries'
import type { Job } from './types'

const job = (status: string, updated_at: number) => ({ id: 'j', status, updated_at }) as Job

describe('newer', () => {
  it('keeps a live update that arrived before the HTTP response', () => {
    const running = job('running', 2)
    expect(newer(running, job('queued', 1))).toBe(running)
  })
  it('takes the incoming snapshot when it is more recent', () => {
    const done = job('succeeded', 3)
    expect(newer(job('running', 2), done)).toBe(done)
  })
  it('takes the incoming snapshot when nothing is cached', () => {
    const queued = job('queued', 1)
    expect(newer(undefined, queued)).toBe(queued)
  })
})
