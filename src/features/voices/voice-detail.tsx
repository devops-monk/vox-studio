import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Download, Loader2, Pause, Play, ShieldCheck, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { VoiceAvatar } from '@/components/voice-avatar'
import { isTauri } from '@/lib/platform'
import { usePrefs } from '@/lib/store/prefs'
import { voxd } from '@/lib/voxd/client'
import { useDeleteCustomVoice, useDesignedVoices, useRenameVoice, useVoiceMeta } from '@/lib/voxd/queries'
import type { LibraryVoice } from '@/lib/voxd/types'
import { useCustomVoices } from '@/lib/voxd/queries'
import { languageName } from '@/lib/format'
import { cn } from '@/lib/cn'
import { TagEditor } from './tag-editor'
import { usePreview } from './use-preview'

const ENGINE: Record<string, string> = { system: 'System', kokoro: 'Kokoro', chatterbox: 'Chatterbox' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-[12px]">
      <span className="text-text-3">{label}</span>
      <span className="text-right text-text-1">{children}</span>
    </div>
  )
}

async function exportVoice(v: LibraryVoice) {
  if (!isTauri) return toast('Export is available in the desktop app')
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: `${v.name}.voxvoice`, filters: [{ name: 'VoxStudio voice', extensions: ['voxvoice'] }] })
  if (!path) return
  try {
    await voxd.exportVoice(v.id, path)
    toast.success('Voice exported', { description: path.split(/[\\/]/).pop() })
  } catch (e) {
    toast.error('Export failed', { description: (e as Error).message })
  }
}

export function VoiceDetail({ voice, allTags, onClose }: { voice: LibraryVoice; allTags: string[]; onClose: () => void }) {
  const meta = useVoiceMeta()
  const rename = useRenameVoice()
  const remove = useDeleteCustomVoice()
  const custom = useCustomVoices().data?.find((c) => c.id === voice.id)
  const designed = useDesignedVoices().data?.find((d) => d.id === voice.id)
  const editable = voice.custom || voice.designed
  const preview = usePreview()
  const navigate = useNavigate()
  const { setEngine, setVoice } = usePrefs()
  const [name, setName] = useState(voice.name)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => setName(voice.name), [voice.name])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const commitName = () => {
    const next = name.trim()
    if (next && next !== voice.name) {
      if (voice.designed) void voxd.renameDesigned(voice.id, next).catch((e: Error) => toast.error(e.message))
      else rename.mutate({ id: voice.id, name: next }, { onError: (e) => toast.error(e.message) })
    }
    else setName(voice.name)
  }

  const use = () => {
    setEngine(voice.engine)
    setVoice(voice.engine, voice.id)
    void navigate({ to: '/studio' })
  }

  return (
    <aside className="glass-pop flex h-full w-[340px] shrink-0 flex-col overflow-hidden rounded-[var(--radius-xl)] animate-[pop-in_220ms_var(--ease-spring)]" aria-label={`${voice.name} details`}>
      <div className="relative flex flex-col items-center gap-3 px-6 pb-5 pt-7 text-center">
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="absolute right-3 top-3">
          <X size={15} />
        </Button>
        <VoiceAvatar id={voice.id} name={voice.name} size={72} />
        {editable ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Voice name"
            maxLength={60}
            className="w-full rounded-[8px] bg-transparent text-center font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.01em] outline-none hover:bg-fill-hover focus:bg-fill-control"
          />
        ) : (
          <h3 className="font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.01em]">{voice.name}</h3>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void preview.toggle(voice)} disabled={!voice.available && !voice.custom}>
            {preview.loading(voice) ? <Loader2 size={13} className="animate-spin" /> : preview.playing(voice) ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            {voice.custom ? 'Original' : 'Preview'}
          </Button>
          <Button
            aria-pressed={voice.favorite}
            onClick={() => meta.mutate({ engine: voice.engine, voice: voice.id, favorite: !voice.favorite })}
            className={cn(voice.favorite && 'text-[#ffcc00]')}
          >
            <Star size={13} fill={voice.favorite ? 'currentColor' : 'none'} /> {voice.favorite ? 'Favorite' : 'Add to favorites'}
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-5">
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">Tags</h4>
          <TagEditor tags={voice.tags} suggestions={allTags} onChange={(tags) => meta.mutate({ engine: voice.engine, voice: voice.id, tags })} />
        </section>

        <section className="divide-y-[0.5px] divide-[var(--hairline)]">
          <Field label="Engine">{ENGINE[voice.engine] ?? voice.engine}{!voice.available && ' (not installed)'}</Field>
          <Field label="Language">{languageName(voice.language)}</Field>
          {voice.gender && <Field label="Gender">{voice.gender === 'female' ? 'Female' : 'Male'}</Field>}
          {voice.duration_s != null && <Field label="Sample">{voice.duration_s.toFixed(1)} seconds</Field>}
          {voice.created_at != null && <Field label="Created">{new Date(voice.created_at * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })}</Field>}
        </section>

        {designed && (
          <section className="rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-fill-control p-3">
            <div className="mb-1.5 text-[12px] font-semibold">Designed from</div>
            <p className="text-[12px] leading-relaxed text-text-2">{designed.description ? `“${designed.description}”` : 'A blend of Kokoro voices'}</p>
            <p className="mt-1.5 text-[11px] text-text-3">
              Blend of {designed.recipe.replace('mix:', '').split(',').map((p) => p.split('=')[0].split('_')[1]).map((n) => n[0].toUpperCase() + n.slice(1)).join(', ')} · pace {designed.speed.toFixed(2)}×
            </p>
          </section>
        )}

        {custom && (
          <section className="rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-fill-control p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
              <ShieldCheck size={14} className="text-[#30d158]" /> Consent record
            </div>
            <p className="text-[12px] leading-relaxed text-text-2">“{custom.consent}”</p>
            <p className="mt-1.5 text-[11px] text-text-3">
              {custom.consent_by ? `Given by ${custom.consent_by} · ` : ''}
              {new Date(custom.created_at * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </section>
        )}
      </div>

      <div className="space-y-2 border-t-[0.5px] border-hairline p-4">
        <Button variant="primary" className="w-full justify-center" onClick={use} disabled={!voice.available}>
          Use in Studio <ArrowRight size={13} />
        </Button>
        {editable && (
          <div className="flex gap-2">
            {voice.custom && (
              <Button className="flex-1 justify-center" onClick={() => void exportVoice(voice)}>
                <Download size={13} /> Export
              </Button>
            )}
            <Button
              variant="ghost"
              className={cn('flex-1 justify-center', confirmDelete && 'bg-[#ff453a]/12 text-[#ff453a] hover:bg-[#ff453a]/20 hover:text-[#ff453a]')}
              onClick={() =>
                !confirmDelete
                  ? setConfirmDelete(true)
                  : voice.designed
                    ? void voxd.deleteDesigned(voice.id).then(() => (toast(`${voice.name} deleted`), onClose()))
                    : remove.mutate(voice.id, { onSuccess: () => (toast(`${voice.name} deleted`), onClose()) })
              }
              onBlur={() => setConfirmDelete(false)}
            >
              <Trash2 size={13} /> {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
