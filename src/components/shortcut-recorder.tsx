import { useEffect, useState } from 'react'
import { Keyboard } from 'lucide-react'
import { Kbd } from '@/components/glass'
import { acceleratorFromEvent, prettyShortcut } from '@/lib/dictation'
import { cn } from '@/lib/cn'

/** Click, then press a key combination (with at least one modifier) to set a global shortcut. */
export function ShortcutRecorder({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
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
