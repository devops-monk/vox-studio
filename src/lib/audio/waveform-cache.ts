import { peaks } from './wav'

const cache = new Map<string, Promise<number[]>>()

/** Fetch, decode and summarize an audio URL into waveform peaks, once per key. */
export function loadPeaks(key: string, url: string, buckets = 96): Promise<number[]> {
  let hit = cache.get(key)
  if (!hit) {
    hit = (async () => {
      const data = await (await fetch(url)).arrayBuffer()
      const ctx = new AudioContext()
      try {
        const audio = await ctx.decodeAudioData(data)
        return peaks(audio.getChannelData(0), buckets)
      } finally {
        void ctx.close()
      }
    })()
    hit.catch(() => cache.delete(key))
    cache.set(key, hit)
  }
  return hit
}
