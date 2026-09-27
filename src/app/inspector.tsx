import { Link } from '@tanstack/react-router'
import { ArrowRight, History, Pause, Play, Star } from 'lucide-react'
import { usePlayer } from '@/lib/audio/player'
import { usePrefs } from '@/lib/store/prefs'
import { timeAgo } from '@/lib/time'
import { voiceLabel } from '@/lib/voice-label'
import { voxd } from '@/lib/voxd/client'
import { useCustomVoices, useDesignedVoices, useTakes } from '@/lib/voxd/queries'
import { cn } from '@/lib/cn'

/** Right-hand panel with your most recent takes, reachable from any page. */
export function Inspector() {
  const open = usePrefs((s) => s.inspectorOpen)
  const takes = useTakes(12).data ?? []
  const custom = useCustomVoices().data ?? []
  const designed = useDesignedVoices().data ?? []
  const { current, play, stop } = usePlayer()

  return (
    <aside
      aria-label="Recent takes"
      aria-hidden={!open}
      className={cn(
        'shrink-0 overflow-hidden border-l-[0.5px] border-hairline transition-[width,opacity] duration-300 ease-[var(--ease-spring)]',
        open ? 'w-[300px] opacity-100' : 'w-0 opacity-0',
      )}
    >
      <div className="flex h-full w-[300px] flex-col">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h3 className="text-[12px] font-semibold tracking-wide text-text-3">Recent takes</h3>
          <Link to="/history" className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline" tabIndex={open ? 0 : -1}>
            All <ArrowRight size={11} />
          </Link>
        </div>
        {takes.length ? (
          <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {takes.map((t) => {
              const playing = current === t.id
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    tabIndex={open ? 0 : -1}
                    onClick={() => (playing ? stop() : void play(t.id, voxd.audioUrl(t)))}
                    className={cn('flex w-full items-start gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-fill-hover', playing && 'bg-fill-active')}
                  >
                    <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', playing ? 'bg-[var(--accent)] text-white' : 'bg-fill-control text-text-2')}>
                      {playing ? <Pause size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" className="ml-px" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[12px] leading-snug text-text-1">{t.text}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-text-3">
                        {t.starred && <Star size={10} fill="#ffcc00" className="text-[#ffcc00]" />}
                        {voiceLabel(t, custom, designed)} · {timeAgo(t.created_at)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-text-3">
            <History size={28} strokeWidth={1.4} />
            <div className="text-[13px] font-medium text-text-2">No takes yet</div>
            <div className="text-[12px]">Generated audio will appear here.</div>
          </div>
        )}
      </div>
    </aside>
  )
}
