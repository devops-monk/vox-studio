import { create } from 'zustand'

interface PlayerState {
  /** Id of whatever is playing (e.g. a take id), or null. */
  current: string | null
  analyser: AnalyserNode | null
  play: (id: string, src: string) => Promise<void>
  stop: () => void
  /** Seek within the current item (seconds). */
  seek: (seconds: number) => void
}

/** Current playback position/duration, read on demand (e.g. in an animation frame). */
export function playbackPosition() {
  return { time: audio?.currentTime ?? 0, duration: audio && Number.isFinite(audio.duration) ? audio.duration : 0 }
}

let audio: HTMLAudioElement | null = null
let ctx: AudioContext | null = null

/** One shared player so starting a take stops the previous one, and the orb can visualize it. */
export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  analyser: null,
  play: async (id, src) => {
    get().stop()
    if (!audio) {
      audio = new Audio()
      audio.crossOrigin = 'anonymous'
      audio.addEventListener('ended', () => set({ current: null }))
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      ctx.createMediaElementSource(audio).connect(analyser)
      analyser.connect(ctx.destination)
      set({ analyser })
    }
    await ctx?.resume()
    audio.src = src
    set({ current: id })
    try {
      await audio.play()
    } catch (err) {
      set({ current: null })
      throw err
    }
  },
  stop: () => {
    audio?.pause()
    set({ current: null })
  },
  seek: (seconds) => {
    if (audio) audio.currentTime = seconds
  },
}))
