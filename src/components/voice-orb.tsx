import { useEffect, useRef } from 'react'

export type OrbMode = 'idle' | 'busy' | 'speaking' | 'error'

interface Props {
  mode: OrbMode
  size?: number
  analyser?: AnalyserNode | null
  className?: string
}

const BARS = 72

/**
 * VoxStudio's signature element: a ring of bars that breathes when idle,
 * sweeps while working, and dances to real audio while speaking.
 */
export function VoiceOrb({ mode, size = 160, analyser, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  const analyserRef = useRef(analyser)
  modeRef.current = mode
  analyserRef.current = analyser

  useEffect(() => {
    const el = canvas.current
    const g = el?.getContext('2d')
    if (!el || !g) return

    const dpr = window.devicePixelRatio || 1
    el.width = size * dpr
    el.height = size * dpr
    g.scale(dpr, dpr)

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const freq = new Uint8Array(128)
    const levels = new Float32Array(BARS)
    let raf = 0

    const draw = (now: number) => {
      const t = now / 1000
      const m = modeRef.current
      const styles = getComputedStyle(el)
      const accent = m === 'error' ? '#ff453a' : styles.getPropertyValue('--accent').trim() || '#0a84ff'
      const c = size / 2
      const inner = size * 0.26
      const maxLen = size * 0.2

      if (m === 'speaking' && analyserRef.current) analyserRef.current.getByteFrequencyData(freq)

      g.clearRect(0, 0, size, size)

      // Soft glow core
      const energy = levels.reduce((a, b) => a + b, 0) / BARS
      const glow = g.createRadialGradient(c, c, 0, c, c, inner * (1.35 + energy * 0.6))
      glow.addColorStop(0, `${accent}66`)
      glow.addColorStop(1, `${accent}00`)
      g.fillStyle = glow
      g.beginPath()
      g.arc(c, c, inner * 1.9, 0, Math.PI * 2)
      g.fill()

      g.lineCap = 'round'
      g.lineWidth = Math.max(1.5, size / 70)
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2
        let target: number
        if (m === 'speaking') {
          // Mirror the spectrum so the ring is symmetric; skip the lowest bin (DC).
          const half = BARS / 2
          const bin = 1 + Math.floor(((i < half ? i : BARS - 1 - i) / half) * 70)
          target = (freq[bin] ?? 0) / 255
        } else if (m === 'busy') {
          target = 0.18 + 0.55 * Math.max(0, Math.sin(t * 5 - (i / BARS) * Math.PI * 4)) ** 3
        } else if (m === 'error') {
          target = 0.08
        } else {
          target = 0.12 + 0.07 * Math.sin(t * 1.4 + i * 0.35) * Math.sin(t * 0.7)
        }
        levels[i] += (target - levels[i]) * 0.22
        const len = 3 + levels[i] * maxLen
        g.strokeStyle = accent
        g.globalAlpha = 0.35 + levels[i] * 0.65
        g.beginPath()
        g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
        g.lineTo(c + Math.cos(a) * (inner + len), c + Math.sin(a) * (inner + len))
        g.stroke()
      }
      g.globalAlpha = 1

      if (!reduceMotion) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

  return <canvas ref={canvas} style={{ width: size, height: size }} className={className} aria-hidden />
}
