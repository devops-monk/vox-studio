// The VoxStudio orb: a ring of bars that "speaks" in a slow, looping phrase.
;(function () {
  const canvas = document.getElementById('orb')
  if (!canvas) return
  const g = canvas.getContext('2d')
  const size = 220
  const dpr = window.devicePixelRatio || 1
  canvas.width = size * dpr
  canvas.height = size * dpr
  g.scale(dpr, dpr)
  const BARS = 80
  const levels = new Float32Array(BARS)
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const accent = '#0a84ff'

  function frame(now) {
    const t = now / 1000
    const c = size / 2
    const inner = size * 0.27
    const maxLen = size * 0.19
    // A syllable-like envelope: bursts of energy with pauses between "words".
    const phrase = Math.max(0, Math.sin(t * 2.1)) * (0.55 + 0.45 * Math.sin(t * 7.3)) * (Math.sin(t * 0.6) > -0.6 ? 1 : 0.15)
    g.clearRect(0, 0, size, size)
    const energy = levels.reduce((a, b) => a + b, 0) / BARS
    const glow = g.createRadialGradient(c, c, 0, c, c, inner * (1.4 + energy * 0.7))
    glow.addColorStop(0, 'rgba(10,132,255,0.45)')
    glow.addColorStop(1, 'rgba(10,132,255,0)')
    g.fillStyle = glow
    g.beginPath()
    g.arc(c, c, inner * 2, 0, Math.PI * 2)
    g.fill()
    g.lineCap = 'round'
    g.lineWidth = 3
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2 - Math.PI / 2
      const half = BARS / 2
      const k = (i < half ? i : BARS - 1 - i) / half
      const target = 0.12 + phrase * (0.35 + 0.65 * Math.abs(Math.sin(k * 9 + t * 3))) * (1 - k * 0.5)
      levels[i] += (target - levels[i]) * 0.18
      const len = 4 + levels[i] * maxLen
      g.strokeStyle = accent
      g.globalAlpha = 0.35 + levels[i] * 0.65
      g.beginPath()
      g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner)
      g.lineTo(c + Math.cos(a) * (inner + len), c + Math.sin(a) * (inner + len))
      g.stroke()
    }
    g.globalAlpha = 1
    if (!still) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()
