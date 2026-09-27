import type { CustomVoice, Take } from './voxd/types'

/** A human name for the voice a take was made with. */
export function voiceLabel(take: Pick<Take, 'engine' | 'voice'>, custom: CustomVoice[] = []) {
  if (take.voice.startsWith('cv_')) return custom.find((v) => v.id === take.voice)?.name ?? 'Deleted voice'
  if (take.engine === 'kokoro') return take.voice.split('_').slice(1).join(' ').replace(/^./, (c) => c.toUpperCase())
  if (take.engine === 'chatterbox' && take.voice === 'default') return 'Chatterbox Default'
  return take.voice
}
