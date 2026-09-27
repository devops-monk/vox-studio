import { peaks } from './wav'

const cache = new Map<string, Promise<number[]>>()
const MAX_PARALLEL = 3
let running = 0
const waiting: (() => void)[] = []

// One decoder for every waveform: browsers cap how many audio contexts can exist at once.
let decoder: OfflineAudioContext | null = null
const getDecoder = () => (decoder ??= new OfflineAudioContext(1, 1, 22050))

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resume) => waiting.push(resume))
  running++
  try {
    return await task()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Fetch, decode and summarize an audio URL into waveform peaks, once per key. */
export function loadPeaks(key: string, url: string, buckets = 96): Promise<number[]> {
  const cacheKey = `${key}:${buckets}`
  let hit = cache.get(cacheKey)
  if (!hit) {
    hit = limited(async () => {
      const data = await (await fetch(url)).arrayBuffer()
      const audio = await getDecoder().decodeAudioData(data)
      return peaks(audio.getChannelData(0), buckets)
    })
    hit.catch(() => cache.delete(cacheKey))
    cache.set(cacheKey, hit)
  }
  return hit
}
