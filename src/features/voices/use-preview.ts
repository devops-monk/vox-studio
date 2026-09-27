import { useState } from 'react'
import { toast } from 'sonner'
import { usePlayer } from '@/lib/audio/player'
import { voxd } from '@/lib/voxd/client'
import type { LibraryVoice } from '@/lib/voxd/types'

// One generated sample per voice per session; replays are instant.
const samples = new Map<string, { id: string; url: string }>()

const key = (v: LibraryVoice) => `${v.engine}:${v.id}`

/** Play a voice: custom voices play their original recording, others speak a short sample. */
export function usePreview() {
  const { current, play, stop } = usePlayer()
  const [loading, setLoading] = useState<string | null>(null)

  const toggle = async (v: LibraryVoice) => {
    const k = key(v)
    if (current === k) return stop()
    try {
      let url = samples.get(k)?.url
      if (!url) {
        if (v.custom) {
          url = voxd.audioUrl({ audio_url: `/v1/voices/custom/${v.id}/audio` })
        } else {
          setLoading(k)
          const take = await voxd.speak({ text: `Hi, I'm ${v.name}. This is how I sound.`, voice: v.id, engine: v.engine, speed: 1 })
          url = voxd.audioUrl(take)
          samples.set(k, { id: take.id, url })
        }
      }
      await play(k, url)
    } catch (e) {
      toast.error('Couldn’t play a sample', { description: (e as Error).message })
    } finally {
      setLoading(null)
    }
  }

  return { toggle, playing: (v: LibraryVoice) => current === key(v), loading: (v: LibraryVoice) => loading === key(v) }
}
