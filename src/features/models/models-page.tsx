import { Cpu, ExternalLink, HardDrive, MemoryStick } from 'lucide-react'
import { GlassPanel } from '@/components/glass'
import { useModels, useSystem } from '@/lib/voxd/queries'
import type { Model } from '@/lib/voxd/types'
import { formatBytes, languageName } from '@/lib/format'
import { FitBadge, ModelActions, ModelArt, Pill } from './model-parts'

/** A voice each engine can preview with. */
const PREVIEW_VOICE: Record<string, string> = { kokoro: 'af_heart', chatterbox: 'default' }

function SystemStrip() {
  const sys = useSystem().data
  if (!sys) return null
  const items = [
    { icon: Cpu, label: sys.chip || sys.arch },
    { icon: MemoryStick, label: `${Math.round(sys.ram_bytes / 1024 ** 3)} GB memory` },
    { icon: HardDrive, label: `${formatBytes(sys.disk_free_bytes)} free` },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ icon: Icon, label }) => (
        <span key={label} className="inline-flex items-center gap-1.5 rounded-full border-[0.5px] border-hairline bg-[var(--glass-2)] px-2.5 py-1 text-[12px] text-text-2">
          <Icon size={13} strokeWidth={1.8} /> {label}
        </span>
      ))}
    </div>
  )
}

function ModelCard({ model, index }: { model: Model; index: number }) {
  const langs = model.languages.map(languageName)
  return (
    <GlassPanel className="p-5 animate-[pop-in_320ms_var(--ease-spring)_both]" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="flex gap-4">
        <ModelArt model={model} size={64} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-[var(--font-display)] text-[17px] font-semibold tracking-[-0.01em]">{model.name}</h3>
            <FitBadge model={model} />
            {model.featured && <Pill>Recommended</Pill>}
          </div>
          <p className="text-[13px] text-text-1">{model.tagline}</p>
          <p className="text-[12px] leading-relaxed text-text-2">{model.description}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Pill>{KIND_LABEL[model.kind] ?? `${model.voice_count} voices`}</Pill>
            <Pill>{formatBytes(model.size_bytes)}{model.runtime_bytes ? ` + ${formatBytes(model.runtime_bytes)} engine` : ''}</Pill>
            <a href={model.license_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-fill-control px-2 py-0.5 text-[11px] font-medium text-text-2 hover:text-text-1">
              {model.license} <ExternalLink size={10} />
            </a>
            <span className="truncate text-[11px] text-text-3" title={langs.join(', ')}>
              {langs.slice(0, 4).join(' · ')}
              {langs.length > 4 && ` +${langs.length - 4} more`}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex min-h-8 items-center justify-end border-t-[0.5px] border-hairline pt-4">
        <ModelActions model={model} previewVoice={PREVIEW_VOICE[model.engine]} />
      </div>
    </GlassPanel>
  )
}

const KIND_LABEL: Record<string, string> = { clone: 'Voice cloning', asr: 'Speech to text', separation: 'For dubbing' }

export function ModelsPage() {
  const models = useModels()
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-8 py-8">
      <section className="space-y-3">
        <div>
          <h2 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Voice models</h2>
          <p className="text-[14px] text-text-2">Download once, then use them offline, as much as you like.</p>
        </div>
        <SystemStrip />
      </section>

      <section className="space-y-3">
        {models.data?.map((m, i) => <ModelCard key={m.id} model={m} index={i} />)}
        {models.isLoading && <GlassPanel className="h-44 animate-pulse" />}
      </section>

      <p className="px-1 text-[12px] text-text-3">
        More models are on the way. Every model runs on your computer; nothing you type or record is uploaded.
      </p>
    </div>
  )
}
