import { useVoxd } from '@/lib/voxd/state'
import { cn } from '@/lib/cn'

const LABEL = {
  starting: 'Starting…',
  booting: 'Starting…',
  loading_engines: 'Loading voices…',
  ready: 'Engine ready',
  error: 'Engine stopped',
  stopped: 'Engine stopped',
} as const

/** Compact status line for the sidebar footer. */
export function EngineStatus() {
  const phase = useVoxd((s) => s.state.phase)
  const tone = phase === 'ready' ? 'bg-[#30d158]' : phase === 'error' || phase === 'stopped' ? 'bg-[#ff453a]' : 'bg-[#ffd60a]'
  return (
    <div className="flex items-center gap-2 px-2 pt-1.5 text-[11px] text-text-3">
      <span className="relative flex size-2">
        {phase !== 'ready' && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', tone)} />}
        <span className={cn('relative size-2 rounded-full', tone)} />
      </span>
      {LABEL[phase]}
    </div>
  )
}
