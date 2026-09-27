import { useEffect, useRef, useState } from 'react'
import { Check, RotateCw, TerminalSquare } from 'lucide-react'
import { VoiceOrb } from '@/components/voice-orb'
import { Button } from '@/components/glass'
import { useVoxd } from '@/lib/voxd/state'
import type { VoxdPhase } from '@/lib/voxd/types'
import { cn } from '@/lib/cn'

const STEPS: { phase: VoxdPhase; label: string }[] = [
  { phase: 'starting', label: 'Launching voice engine' },
  { phase: 'booting', label: 'Preparing runtime' },
  { phase: 'loading_engines', label: 'Checking voices' },
]
const ORDER: VoxdPhase[] = ['starting', 'booting', 'loading_engines', 'ready']

/** Full-window glass sheet shown until voxd is ready. Fades away once it is. */
export function EngineGate() {
  const { state, logs, restart } = useVoxd()
  const ready = state.phase === 'ready'
  const failed = state.phase === 'error' || state.phase === 'stopped'
  const [showLogs, setShowLogs] = useState(false)
  const [gone, setGone] = useState(ready)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!ready) return setGone(false)
    const t = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(t)
  }, [ready])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs, showLogs])

  if (gone) return null
  const current = ORDER.indexOf(state.phase)

  return (
    <div
      role="status"
      aria-live="polite"
      data-tauri-drag-region
      className={cn(
        'fixed inset-0 z-30 flex items-center justify-center bg-[var(--glass-1)] backdrop-blur-2xl transition-opacity duration-500',
        ready ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <div className="flex w-[420px] flex-col items-center text-center animate-[pop-in_400ms_var(--ease-spring)]">
        <VoiceOrb mode={failed ? 'error' : 'busy'} size={176} />
        <h2 className="mt-2 font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.02em]">
          {failed ? 'The voice engine didn’t start' : 'Warming up VoxStudio'}
        </h2>
        <p className="mt-1 min-h-[20px] max-w-[360px] text-[13px] text-text-2">
          {state.detail ?? (failed ? 'Something went wrong.' : 'Just a moment…')}
        </p>

        {!failed && (
          <ol className="mt-6 w-full space-y-2 text-left">
            {STEPS.map((step, i) => {
              const done = current > i
              const active = current === i
              return (
                <li key={step.phase} className="flex items-center gap-3 text-[13px]">
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full border-[0.5px] transition-all duration-300',
                      done && 'border-transparent bg-[var(--accent)] text-white',
                      active && 'border-[var(--accent)]',
                      !done && !active && 'border-hairline',
                    )}
                  >
                    {done ? <Check size={12} strokeWidth={3} /> : active ? <span className="size-1.5 animate-pulse rounded-full bg-[var(--accent)]" /> : null}
                  </span>
                  <span className={cn(done || active ? 'text-text-1' : 'text-text-3')}>{step.label}</span>
                </li>
              )
            })}
          </ol>
        )}

        <div className="mt-6 flex gap-2">
          {failed && (
            <Button variant="primary" onClick={() => void restart()}>
              <RotateCw size={14} /> Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setShowLogs((v) => !v)}>
            <TerminalSquare size={13} /> {showLogs ? 'Hide details' : 'Show details'}
          </Button>
        </div>

        {showLogs && (
          <pre
            ref={logRef}
            className="glass mt-4 h-44 w-[560px] max-w-[90vw] select-text overflow-auto rounded-[var(--radius-md)] p-3 text-left font-mono text-[11px] leading-relaxed text-text-2"
          >
            {logs.length ? logs.join('\n') : 'No output yet.'}
          </pre>
        )}
      </div>
    </div>
  )
}
