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
  /** Whole-clip RMS (includes pauses). */
  rmsDb: number
  /** Level while someone is speaking (the loudest 30% of 50 ms frames). */
  speechDb: number
  /** Background level (the quietest 20% of frames). */
  noiseDb: number
  /** How far the voice stands out from the background. */
  snrDb: number
  /** Gain applied by normalizeClip, in dB (0 when none was needed). */
  boostDb: number
  issues: { level: 'error' | 'warn'; message: string }[]
}

const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-9))

/** Frame-level loudness: speech level, noise floor and their difference. */
function levels(samples: Float32Array, rate: number) {
  const size = Math.max(1, Math.round(rate * 0.05))
  const frames: number[] = []
  for (let i = 0; i + size <= samples.length; i += size) {
    let sum = 0
    for (let j = i; j < i + size; j++) sum += samples[j] * samples[j]
    frames.push(Math.sqrt(sum / size))
  }
  if (!frames.length) return { speechDb: -120, noiseDb: -120 }
  frames.sort((a, b) => a - b)
  const mean = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / Math.max(1, xs.length))
  const speech = mean(frames.slice(Math.floor(frames.length * 0.7)))
  const noise = mean(frames.slice(0, Math.max(1, Math.floor(frames.length * 0.2))))
  return { speechDb: dB(speech), noiseDb: dB(noise) }
}

const TARGET_SPEECH_DB = -20
const PEAK_CEILING_DB = -1

/** Raise quiet recordings to a standard speaking level (never past −1 dBFS peaks). */
export function normalizeClip(samples: Float32Array, rate = CLONE_RATE): { samples: Float32Array; boostDb: number } {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  const { speechDb } = levels(samples, rate)
  const gainDb = Math.min(TARGET_SPEECH_DB - speechDb, PEAK_CEILING_DB - dB(peak), 30)
  if (gainDb <= 0.5) return { samples, boostDb: 0 }
  const g = 10 ** (gainDb / 20)
  return { samples: samples.map((s) => s * g), boostDb: gainDb }
}

/**
 * Quick checks that predict a good clone. Loudness is judged while speaking and against the
 * background (quiet-but-clean audio is fine — it's boosted), so pauses don't count against you.
 */
export function analyzeClip(samples: Float32Array, rate = CLONE_RATE, boostDb = 0): ClipQuality {
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
  const rmsDb = dB(Math.sqrt(sum / Math.max(1, samples.length)))
  const { speechDb, noiseDb } = levels(samples, rate)
  const snrDb = speechDb - noiseDb
  const issues: ClipQuality['issues'] = []
  if (duration < 3) issues.push({ level: 'error', message: 'Too short: record at least 5 seconds, 10–20 is ideal.' })
  else if (duration < 8) issues.push({ level: 'warn', message: 'A bit short: 10–20 seconds gives a closer match.' })
  if (duration > 60) issues.push({ level: 'error', message: 'Too long: keep it under 60 seconds.' })
  if (speechDb - boostDb < -60) issues.push({ level: 'error', message: 'No voice was picked up. Check that the right microphone is selected in System Settings → Sound.' })
  else if (snrDb < 10) issues.push({ level: 'error', message: 'The background is almost as loud as the voice. Record somewhere quieter, or closer to the microphone.' })
  else if (snrDb < 18) issues.push({ level: 'warn', message: 'Some background noise: a quieter spot will give a cleaner voice.' })
  if (clipped / samples.length > 0.001) issues.push({ level: 'warn', message: 'Some distortion: move back a little or speak softer.' })
  return { duration, peak, rmsDb, speechDb, noiseDb, snrDb, boostDb, issues }
}
