import { useState } from 'react'
import { FileAudio, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { useImportVoice } from '@/lib/voxd/queries'

const STATEMENT = 'I have permission from the person in this voice to use it.'

export function ImportDialog({ file, onClose, onImported }: { file: File; onClose: () => void; onImported: (id: string) => void }) {
  const [agreed, setAgreed] = useState(false)
  const [by, setBy] = useState('')
  const importVoice = useImportVoice()

  const submit = () =>
    importVoice.mutate(
      { file, consent: STATEMENT, consentBy: by },
      {
        onSuccess: (v) => {
          toast.success(`${v.name} imported`)
          onImported(v.id)
          onClose()
        },
        onError: (e) => toast.error('Import failed', { description: e.message }),
      },
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6 animate-[fade-in_150ms_ease-out]" role="dialog" aria-modal aria-label="Import voice" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-pop w-[440px] rounded-[20px] p-6 animate-[pop-in_260ms_var(--ease-spring)]">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
            <FileAudio size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold">Import a voice</h3>
            <p className="truncate text-[12px] text-text-3">{file.name}</p>
          </div>
        </div>
        <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-md)] bg-fill-control p-3 text-[12px] leading-relaxed">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            {STATEMENT}
            <span className="mt-1 block text-[11px] text-text-3">Saved alongside the voice’s original consent record.</span>
          </span>
        </label>
        <input
          value={by}
          onChange={(e) => setBy(e.target.value)}
          placeholder="Who gave permission? (optional)"
          aria-label="Who gave permission"
          maxLength={120}
          className="mt-3 h-8 w-full rounded-[8px] border-[0.5px] border-hairline bg-[var(--glass-3)] px-3 text-[12px] outline-none"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!agreed || importVoice.isPending} onClick={submit}>
            {importVoice.isPending && <Loader2 size={13} className="animate-spin" />} Import
          </Button>
        </div>
      </div>
    </div>
  )
}
