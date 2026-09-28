import { describe, expect, it } from 'vitest'
import { analyzeClip, CLONE_RATE, normalizeClip } from './wav'

/** Speech-like test signal: 400 ms tone bursts with 200 ms pauses, over a noise floor. */
function speechLike(seconds: number, speechAmp: number, noiseAmp: number) {
  const out = new Float32Array(Math.round(seconds * CLONE_RATE))
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < out.length; i++) {
    const t = i / CLONE_RATE
    const talking = t % 0.6 < 0.4
    out[i] = (talking ? speechAmp * Math.sin(2 * Math.PI * 180 * t) : 0) + noiseAmp * rand()
  }
  return out
}

describe('clone recording checks', () => {
  it('boosts a quiet but clean recording instead of rejecting it', () => {
    const quiet = speechLike(12, 0.01, 0.0002) // about −43 dBFS while speaking
    expect(analyzeClip(quiet).issues.some((i) => i.level === 'error')).toBe(false)
    const { samples, boostDb } = normalizeClip(quiet)
    expect(boostDb).toBeGreaterThan(15)
    const after = analyzeClip(samples, CLONE_RATE, boostDb)
    expect(after.speechDb).toBeGreaterThan(-24)
    expect(after.peak).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6) // never clipped
    expect(after.issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('leaves a well-recorded clip alone', () => {
    const good = speechLike(12, 0.3, 0.001)
    expect(normalizeClip(good).boostDb).toBe(0)
  })

  it('rejects silence and noise-only recordings', () => {
    expect(analyzeClip(new Float32Array(CLONE_RATE * 12)).issues[0].message).toMatch(/No voice/)
    const noisy = speechLike(12, 0.02, 0.02)
    expect(analyzeClip(noisy).issues.some((i) => i.level === 'error' && /background/.test(i.message))).toBe(true)
  })
})
