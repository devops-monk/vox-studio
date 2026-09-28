import { Download, Pause, Play, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { AddToProject } from '@/components/add-to-project'
import { Waveform } from '@/components/waveform'
import { VoiceAvatar } from '@/components/voice-avatar'
import { usePlayer } from '@/lib/audio/player'
import { saveTake } from '@/lib/save'
import { voiceLabel } from '@/lib/voice-label'
import { timeAgo } from '@/lib/time'
import { voxd } from '@/lib/voxd/client'
import { useStarTake } from '@/lib/voxd/queries'
import type { CustomVoice, DesignedVoice, Take } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

export function TakeCard({ take, custom, designed = [] }: { take: Take; custom: CustomVoice[]; designed?: DesignedVoice[] }) {
  const { current, play, stop } = usePlayer()
  const star = useStarTake()
  const playing = current === take.id
  const url = voxd.audioUrl(take)
  const name = voiceLabel(take, custom, designed)

  return (
    <article className="glass group rounded-[var(--radius-lg)] p-3.5 animate-[pop-in_260ms_var(--ease-spring)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? stop() : void play(take.id, url).catch((e: Error) => toast.error(e.message)))}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full transition-all duration-200',
            playing ? 'bg-[var(--accent)] text-white shadow-[0_4px_14px_color-mix(in_srgb,var(--accent)_45%,transparent)]' : 'bg-fill-control text-text-1 hover:bg-fill-active',
          )}
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <Waveform id={take.id} url={url} duration={take.duration_s} className="min-w-0 flex-1" />
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-text-3">{take.duration_s.toFixed(1)}s</span>
      </div>
      <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-text-1" title={take.text}>
        {take.text}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <VoiceAvatar id={take.voice} name={name} size={18} />
        <span className="truncate text-[11px] text-text-2">
          {name} · <span className="capitalize">{take.engine}</span> · {timeAgo(take.created_at)}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          aria-label={take.starred ? 'Unstar' : 'Star'}
          aria-pressed={take.starred}
          onClick={() => star.mutate({ id: take.id, starred: !take.starred })}
          className={cn(take.starred ? 'text-[#ffcc00] hover:text-[#ffcc00]' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <Star size={14} fill={take.starred ? 'currentColor' : 'none'} />
        </Button>
        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <AddToProject kind="take" id={take.id} compact />
        </div>
        <Button variant="ghost" size="icon" aria-label="Save as…" onClick={() => void saveTake(take)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
          <Download size={14} />
        </Button>
      </div>
    </article>
  )
}
