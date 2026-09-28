import { useEffect, useRef, useState } from 'react'
import { Check, Mic, X } from 'lucide-react'
import { VoiceOrb } from '@/components/voice-orb'
import { startLiveTranscription } from '@/lib/audio/mic-stream'
import { dictation, prettyShortcut } from '@/lib/dictation'
import { usePrefs } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useVoxd } from '@/lib/voxd/state'
import { cn } from '@/lib/cn'

type Phase = 'idle' | 'starting' | 'listening' | 'finishing' | 'copied' | 'error'
const AUTO_FINISH_MS = 2200

/** The floating dictation capsule (its own always-on-top window). */
export function Pill() {
  const prefs = usePrefs((s) => s.dictation)
  const ready = useVoxd((s) => s.state.phase === 'ready')
  const [phase, setPhase] = useState<Phase>('idle')
  const [text, setText] = useState('')
  const [partial, setPartial] = useState('')
  const [error, setError] = useState('')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const session = useRef<{ stop: () => void } | null>(null)
  const cancelled = useRef(false)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  useEffect(() => {
    document.documentElement.dataset.pill = 'true'
  }, [])

  const finish = async (finalText: string) => {
    void dictation.log(`done: ${finalText.trim().length} chars${cancelled.current ? ' (cancelled)' : ''}`)
    session.current = null
    setAnalyser(null)
    if (cancelled.current || !finalText.trim()) {
      setPhase('idle')
      void dictation.hide()
      return
    }
    const status = await dictation.status().catch(() => ({ accessibility: true }))
    if (!prefs.paste || !status.accessibility) {
      setPhase('copied')
      await new Promise((r) => setTimeout(r, 1600))
    }
    const result = await dictation.insert(finalText, prefs.paste).catch((e: unknown) => (void dictation.log(`insert failed: ${String(e)}`), null))
    if (result) void dictation.log(result.pasted ? 'pasted into the focused app' : 'copied to the clipboard')
    setPhase('idle')
    setText('')
    setPartial('')
  }

  const start = async () => {
    cancelled.current = false
    setText('')
    setPartial('')
    setError('')
    setPhase('starting')
    try {
      const s = await startLiveTranscription(voxd.liveUrl({ save: 'false', ...(prefs.language ? { language: prefs.language } : {}) }), {
        onPartial: (t) => {
          clearTimeout(idle.current)
          setPartial(t)
        },
        onFinal: (seg) => {
          setText((prev) => `${prev} ${seg.text}`.trim())
          setPartial('')
          if (prefs.autoFinish) {
            clearTimeout(idle.current)
            idle.current = setTimeout(() => phaseRef.current === 'listening' && stop(), AUTO_FINISH_MS)
          }
        },
        onDone: ({ text: all }) => void finish(all),
        onError: (message) => {
          void dictation.log(`live error: ${message}`)
          setError(message)
          setPhase('error')
          setTimeout(() => void dictation.hide(), 2500)
        },
      })
      session.current = s
      setAnalyser(s.analyser)
      setPhase('listening')
      void dictation.log('listening')
    } catch (e) {
      void dictation.log(`start failed: ${(e as Error).message}`)
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const stop = () => {
    clearTimeout(idle.current)
    setPhase('finishing')
    session.current?.stop()
  }

  const cancel = () => {
    cancelled.current = true
    clearTimeout(idle.current)
    if (session.current) session.current.stop()
    else void dictation.hide()
    setPhase('idle')
  }

  // The global shortcut (and tray item) toggle listening.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen('dictation://toggle', () => {
        const p = phaseRef.current
        if (p === 'listening') stop()
        else if (p === 'idle' || p === 'error' || p === 'copied') void start()
      }).then((u) => {
        // The effect may have been cleaned up while `listen` was still registering.
        if (disposed) u()
        else unlisten = u
      }),
    )
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    window.addEventListener('keydown', onKey)
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('keydown', onKey)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Created by the first shortcut press: start as soon as we know where voxd is.
  const autostarted = useRef(false)
  useEffect(() => {
    if (!ready || autostarted.current || !window.location.hash.startsWith('#/pill/start')) return
    autostarted.current = true
    history.replaceState(null, '', '#/pill')
    void start()
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = `${text} ${partial}`.trim()
  const hint =
    phase === 'copied'
      ? 'Copied — press ⌘V to paste'
      : phase === 'error'
        ? error
        : phase === 'finishing'
          ? 'Finishing…'
          : !ready
            ? 'Starting the voice engine…'
            : shown
              ? ''
              : `Listening… ${prettyShortcut(prefs.shortcut)} to finish`

  return (
    <div className="flex h-screen w-screen items-center justify-center p-2">
      <div className="glass-pop flex h-full w-full items-center gap-3 rounded-full py-2 pl-2 pr-3 animate-[pop-in_220ms_var(--ease-spring)]">
        <div className="relative flex size-14 shrink-0 items-center justify-center">
          <VoiceOrb mode={phase === 'listening' ? 'speaking' : phase === 'error' ? 'error' : 'busy'} analyser={analyser} size={56} />
          <span className="absolute text-[var(--accent)]">
            {phase === 'copied' ? <Check size={16} strokeWidth={3} /> : phase === 'listening' ? null : <Mic size={14} />}
          </span>
        </div>
        <div className="min-w-0 flex-1" dir="rtl">
          {/* rtl + ltr span keeps the newest words visible when text overflows */}
          <p className={cn('truncate text-[14px] leading-snug', shown ? 'text-text-1' : 'text-text-3')} dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'plaintext' }}>
            {shown ? (
              <>
                {text} <span className="text-text-3">{partial}</span>
              </>
            ) : (
              hint
            )}
          </p>
          {shown && hint && <p className="truncate text-[11px] text-text-3" dir="ltr">{hint}</p>}
        </div>
        <button type="button" aria-label="Cancel dictation" onClick={cancel} className="flex size-7 shrink-0 items-center justify-center rounded-full text-text-3 hover:bg-fill-hover hover:text-text-1">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
