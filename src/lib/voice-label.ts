import type { CustomVoice, DesignedVoice, Take } from './voxd/types'

/** A human name for the voice a take was made with. */
export function voiceLabel(take: Pick<Take, 'engine' | 'voice'>, custom: CustomVoice[] = [], designed: DesignedVoice[] = []) {
  if (take.engine === 'tools') return 'Cleaned audio'
  if (take.voice.startsWith('dv_')) return designed.find((v) => v.id === take.voice)?.name ?? 'Deleted voice'
  if (take.voice.startsWith('mix:')) return 'Voice blend'
  if (take.voice.startsWith('cv_')) return custom.find((v) => v.id === take.voice)?.name ?? 'Deleted voice'
  if (take.engine === 'kokoro') return take.voice.split('_').slice(1).join(' ').replace(/^./, (c) => c.toUpperCase())
  if (take.engine.startsWith('chatterbox') && take.voice === 'default') return 'Chatterbox Default'
  return take.voice
}
