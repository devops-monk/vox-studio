import { useEffect, useState } from 'react'
import { CheckCircle2, Keyboard, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button, GlassPanel, Kbd, Switch } from '@/components/glass'
import { acceleratorFromEvent, dictation, prettyShortcut, type DictationStatus } from '@/lib/dictation'
import { isMac } from '@/lib/platform'
import { usePrefs } from '@/lib/store/prefs'
import { cn } from '@/lib/cn'

const LANGS: [string, string][] = [
  ['', 'Detect automatically'],
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
]

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-[12px] text-text-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') return setRecording(false)
      const acc = acceleratorFromEvent(e)
      if (acc) {
        setRecording(false)
        onChange(acc)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])
  return (
    <button
      type="button"
      onClick={() => setRecording((r) => !r)}
      className={cn(
        'flex h-8 min-w-36 items-center justify-center gap-2 rounded-[8px] border px-3 text-[13px] transition-colors',
        recording ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)]' : 'border-hairline bg-fill-control hover:bg-fill-hover',
      )}
    >
      <Keyboard size={13} />
      {recording ? 'Press new shortcut…' : <Kbd>{prettyShortcut(value)}</Kbd>}
    </button>
  )
}

export function DictationSettings() {
  const { dictation: prefs, setDictation } = usePrefs()
  const [status, setStatus] = useState<DictationStatus | null>(null)

  useEffect(() => {
    if (!dictation.available) return
    const refresh = () => void dictation.status().then(setStatus)
    refresh()
    window.addEventListener('focus', refresh) // re-check after the user visits System Settings
    return () => window.removeEventListener('focus', refresh)
  }, [])

  if (!dictation.available) return null

  const changeShortcut = (acc: string) =>
    dictation
      .setShortcut(acc)
      .then(() => {
        setDictation({ shortcut: acc })
        toast.success(`Dictation shortcut is now ${prettyShortcut(acc)}`)
      })
      .catch((e: unknown) => toast.error(String(e)))

  return (
    <section className="space-y-2">
      <GlassPanel className="divide-y-[0.5px] divide-[var(--hairline)]">
        <Row label="Shortcut" hint="Press it in any app to start dictating; press again to finish.">
          <ShortcutRecorder value={prefs.shortcut} onChange={changeShortcut} />
        </Row>
        {isMac && status && (
          <Row
            label="Type into other apps"
            hint={
              status.accessibility
                ? 'VoxStudio can paste your words where you’re typing.'
                : 'Needs Accessibility access. Without it, your words are copied and you press ⌘V.'
            }
          >
            {status.accessibility ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#30d158]">
                <CheckCircle2 size={14} /> Allowed
              </span>
            ) : (
              <Button onClick={() => void dictation.openAccessibility()}>
                <ShieldAlert size={13} /> Grant access
              </Button>
            )}
          </Row>
        )}
        <Row label="Paste automatically" hint="Off: your words are only copied to the clipboard.">
          <Switch label="Paste automatically" checked={prefs.paste} onChange={(paste) => setDictation({ paste })} />
        </Row>
        <Row label="Finish after a pause" hint="Stops listening about two seconds after you stop talking.">
          <Switch label="Finish after a pause" checked={prefs.autoFinish} onChange={(autoFinish) => setDictation({ autoFinish })} />
        </Row>
        <Row label="Language">
          <select
            value={prefs.language}
            onChange={(e) => setDictation({ language: e.target.value })}
            aria-label="Dictation language"
            className="h-7 rounded-[7px] border-[0.5px] border-hairline bg-fill-control px-2 text-[12px] outline-none"
          >
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Try it" hint="Opens the dictation pill right now.">
          <Button onClick={() => void dictation.toggle()}>Start dictation</Button>
        </Row>
      </GlassPanel>
    </section>
  )
}
