import { voxd } from '@/lib/voxd/client'
import { layout, type Clip, type Mix } from './editor-store'

/** Decoded takes, with fine peaks (100 per second) for drawing any slice of them. */
export interface Source {
  buffer: AudioBuffer
  peaks: Float32Array
}
export const PEAKS_PER_SECOND = 100

let ctx: AudioContext | null = null
const audio = () => (ctx ??= new AudioContext())
const sources = new Map<string, Promise<Source>>()

export function loadSource(takeId: string): Promise<Source> {
  let hit = sources.get(takeId)
  if (!hit) {
    hit = (async () => {
      const data = await (await fetch(voxd.mediaUrl(`/v1/takes/${takeId}/audio`))).arrayBuffer()
      const buffer = await audio().decodeAudioData(data)
      const ch = buffer.getChannelData(0)
      const step = buffer.sampleRate / PEAKS_PER_SECOND
      const peaks = new Float32Array(Math.ceil(ch.length / step))
      for (let i = 0; i < peaks.length; i++) {
        let max = 0
        for (let j = Math.floor(i * step), end = Math.min(ch.length, Math.floor((i + 1) * step)); j < end; j++) max = Math.max(max, Math.abs(ch[j]))
        peaks[i] = max
      }
      return { buffer, peaks }
    })()
    hit.catch(() => sources.delete(takeId))
    sources.set(takeId, hit)
  }
  return hit
}

const dbToGain = (db: number) => 10 ** (db / 20)

/**
 * Plays the timeline with Web Audio, matching what the server renders: clip gains, equal-power-ish
 * crossfades at joins (or gaps), fades and overall gain. Normalize is applied only when saving.
 */
export class Preview {
  private nodes: AudioScheduledSourceNode[] = []
  private startedAt = 0
  private from = 0
  playing = false
  onEnd: (() => void) | null = null

  async play(clips: Clip[], mix: Mix, from: number) {
    this.stop()
    const c = audio()
    if (c.state === 'suspended') await c.resume()
    const loaded = await Promise.all(clips.map((clip) => loadSource(clip.takeId)))
    const { positions, total } = layout(clips, mix)
    if (from >= total) from = 0
    const master = c.createGain()
    master.connect(c.destination)
    const now = c.currentTime + 0.05
    const gain = dbToGain(mix.gainDb)
    // Overall gain with fades, positioned relative to where playback starts.
    master.gain.setValueAtTime(gain, now)
    if (mix.fadeInS > 0 && from < mix.fadeInS) {
      master.gain.setValueAtTime(gain * (from / mix.fadeInS) ** 2, now)
      master.gain.linearRampToValueAtTime(gain, now + (mix.fadeInS - from))
    }
    if (mix.fadeOutS > 0) {
      const fadeStart = Math.max(from, total - mix.fadeOutS)
      master.gain.setValueAtTime(gain, now + (fadeStart - from))
      master.gain.linearRampToValueAtTime(0.0001, now + (total - from))
    }
    const xfade = mix.gapS > 0 ? 0 : mix.crossfadeMs / 1000
    clips.forEach((clip, i) => {
      const pos = positions[i]
      const dur = clip.end - clip.start
      if (pos + dur <= from) return
      const src = c.createBufferSource()
      src.buffer = loaded[i].buffer
      const g = c.createGain()
      const level = dbToGain(clip.gainDb)
      const when = now + Math.max(0, pos - from)
      const skip = Math.max(0, from - pos)
      g.gain.setValueAtTime(level, when)
      if (xfade && i > 0 && skip < xfade) {
        g.gain.setValueAtTime(0.0001, when)
        g.gain.linearRampToValueAtTime(level, when + (xfade - skip))
      }
      if (xfade && i < clips.length - 1) {
        g.gain.setValueAtTime(level, when + dur - skip - xfade)
        g.gain.linearRampToValueAtTime(0.0001, when + dur - skip)
      }
      src.connect(g).connect(master)
      src.start(when, clip.start + skip, dur - skip)
      this.nodes.push(src)
    })
    const last = this.nodes.at(-1)
    if (last) last.onended = () => this.playing && (this.stop(), this.onEnd?.())
    this.startedAt = now
    this.from = from
    this.playing = true
  }

  /** Current timeline position in seconds. */
  position() {
    return this.playing && ctx ? this.from + Math.max(0, ctx.currentTime - this.startedAt) : this.from
  }

  stop() {
    const was = this.playing
    this.playing = false
    for (const n of this.nodes) {
      n.onended = null
      try {
        n.stop()
      } catch {
        /* not started */
      }
    }
    this.nodes = []
    if (was && ctx) this.from = this.from + Math.max(0, ctx.currentTime - this.startedAt)
  }

  seek(t: number) {
    this.from = t
  }
}
