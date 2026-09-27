/** Browser-side audio helpers: decode anything the webview can play, and encode 16-bit PCM WAV. */

export const CLONE_RATE = 24000

/** Decode any supported audio (webm/opus, mp3, m4a, wav…) and resample to mono at `rate`. */
export async function decodeToMono(data: ArrayBuffer, rate = CLONE_RATE): Promise<Float32Array> {
  const probe = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await probe.decodeAudioData(data.slice(0))
  } finally {
    void probe.close()
  }
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate)
  const src = offline.createBufferSource()
  src.buffer = decoded // multi-channel is down-mixed to the mono destination
  src.connect(offline.destination)
  src.start()
  return (await offline.startRendering()).getChannelData(0)
}

export function encodeWav(samples: Float32Array, rate = CLONE_RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const str = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Bucketed absolute peaks (0–1) for drawing a waveform. */
export function peaks(samples: Float32Array, buckets: number): number[] {
  const size = Math.max(1, Math.floor(samples.length / buckets))
  const out: number[] = []
  for (let b = 0; b < buckets; b++) {
    let max = 0
    for (let i = b * size, end = Math.min(samples.length, i + size); i < end; i++) max = Math.max(max, Math.abs(samples[i]))
    out.push(max)
  }
  const top = Math.max(0.01, ...out)
  return out.map((p) => p / top)
}

export interface ClipQuality {
  duration: number
  peak: number
  rmsDb: number
  issues: { level: 'error' | 'warn'; message: string }[]
}

/** Quick checks that predict a good clone: length, loudness and clipping. */
export function analyzeClip(samples: Float32Array, rate = CLONE_RATE): ClipQuality {
  let peak = 0
  let sum = 0
  let clipped = 0
  for (const s of samples) {
    const a = Math.abs(s)
    peak = Math.max(peak, a)
    sum += s * s
    if (a > 0.99) clipped++
  }
  const duration = samples.length / rate
  const rmsDb = 20 * Math.log10(Math.sqrt(sum / Math.max(1, samples.length)) || 1e-9)
  const issues: ClipQuality['issues'] = []
  if (duration < 3) issues.push({ level: 'error', message: 'Too short: record at least 5 seconds, 10–20 is ideal.' })
  else if (duration < 8) issues.push({ level: 'warn', message: 'A bit short: 10–20 seconds gives a closer match.' })
  if (duration > 60) issues.push({ level: 'error', message: 'Too long: keep it under 60 seconds.' })
  if (rmsDb < -40) issues.push({ level: 'error', message: 'Very quiet: move closer to the microphone.' })
  else if (rmsDb < -30) issues.push({ level: 'warn', message: 'A little quiet: speak up or move closer.' })
  if (clipped / samples.length > 0.001) issues.push({ level: 'warn', message: 'Some distortion: move back a little or speak softer.' })
  return { duration, peak, rmsDb, issues }
}
