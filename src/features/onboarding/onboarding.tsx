import { useEffect, useState } from 'react'
import { ArrowRight, Check, CloudOff, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/glass'
import { VoiceOrb } from '@/components/voice-orb'
import { usePrefs } from '@/lib/store/prefs'
import { useDownloadModel, useModels } from '@/lib/voxd/queries'
import { useVoxd } from '@/lib/voxd/state'
import type { Model } from '@/lib/voxd/types'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/cn'
import { DownloadBar, FitBadge, ModelArt, useDownloadProgress } from '@/features/models/model-parts'

type Step = 'welcome' | 'choose' | 'download'

const PROMISES = [
  { icon: Lock, title: 'Private by design', body: 'Your scripts and recordings never leave this computer.' },
  { icon: CloudOff, title: 'Works offline', body: 'Once a model is downloaded, no internet is needed.' },
  { icon: Sparkles, title: 'Yours to keep', body: 'No credits, no subscriptions, no limits.' },
]

function Dots({ step }: { step: Step }) {
  const steps: Step[] = ['welcome', 'choose', 'download']
  return (
    <div className="flex justify-center gap-1.5" aria-hidden>
      {steps.map((s) => (
        <span key={s} className={cn('h-1.5 rounded-full transition-all duration-300', s === step ? 'w-5 bg-[var(--accent)]' : 'w-1.5 bg-[var(--hairline-strong)]')} />
      ))}
    </div>
  )
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-4 rounded-[var(--radius-lg)] border p-4 text-left transition-all duration-200',
        selected
          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,var(--glass-2))] shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]'
          : 'border-hairline bg-[var(--glass-2)] hover:bg-fill-hover',
      )}
    >
      {children}
      <span className={cn('ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-transparent bg-[var(--accent)] text-white' : 'border-[var(--hairline-strong)]')}>
        {selected && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  )
}

function Downloading({ model, onDone }: { model: Model; onDone: () => void }) {
  const dl = useDownloadProgress(model)
  const installed = model.status === 'installed'
  return (
    <div className="flex flex-col items-center text-center">
      <VoiceOrb mode={installed ? 'idle' : 'busy'} size={150} />
      <h2 className="mt-1 font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.02em]">
        {installed ? `${model.name} is ready` : `Getting ${model.name}`}
      </h2>
      <p className="mt-1 max-w-sm text-[13px] text-text-2">
        {installed
          ? `${model.voice_count} new voices are waiting for you on Home.`
          : 'This is a one-time download. Feel free to look around while it finishes.'}
      </p>
      <div className="mt-6 w-full max-w-sm">
        {installed ? (
          <Button variant="primary" className="w-full justify-center" onClick={onDone}>
            Start creating <ArrowRight size={14} />
          </Button>
        ) : (
          <>
            <DownloadBar progress={dl?.progress ?? 0} message={dl?.message ?? 'Starting…'} />
            <Button variant="ghost" size="sm" className="mx-auto mt-4" onClick={onDone}>
              Continue in background
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** First-run sheet: welcome → pick starter voices → download. Shown once. */
export function Onboarding() {
  const ready = useVoxd((s) => s.state.phase === 'ready')
  const { onboardingDone, finishOnboarding, setEngine } = usePrefs()
  const models = useModels().data
  const download = useDownloadModel()
  const [step, setStep] = useState<Step>('welcome')
  const [pick, setPick] = useState<string | null>(null)

  const featured = models?.find((m) => m.featured)
  const anyInstalled = models?.some((m) => m.status === 'installed')
  const chosen = models?.find((m) => m.id === pick)

  useEffect(() => {
    if (featured && pick === null) setPick(featured.fit.level === 'no' ? '' : featured.id)
  }, [featured, pick])

  // Someone who already has a model doesn't need the tour.
  const visible = ready && !onboardingDone && models !== undefined && (!anyInstalled || step === 'download')
  if (!visible) return null

  const finish = () => {
    if (chosen?.status === 'installed') setEngine(chosen.engine)
    finishOnboarding()
  }

  const start = () => {
    if (!chosen) return finish()
    download.mutate(chosen.id, {
      onSuccess: () => setStep('download'),
      onError: (e) => toast.error('Download couldn’t start', { description: e.message }),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6 animate-[fade-in_200ms_ease-out]" role="dialog" aria-modal aria-label="Welcome to VoxStudio">
      <div className="glass-pop w-[560px] max-w-full rounded-[24px] p-8 animate-[pop-in_380ms_var(--ease-spring)]">
        {step === 'welcome' && (
          <div className="flex flex-col items-center text-center">
            <VoiceOrb mode="idle" size={150} />
            <h2 className="mt-1 font-[var(--font-display)] text-[26px] font-bold tracking-[-0.025em]">Welcome to VoxStudio</h2>
            <p className="mt-1 text-[14px] text-text-2">A voice studio that lives entirely on your computer.</p>
            <ul className="mt-6 w-full space-y-3 text-left">
              {PROMISES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">
                    <Icon size={16} strokeWidth={1.9} />
                  </span>
                  <div>
                    <div className="text-[13px] font-semibold">{title}</div>
                    <div className="text-[12px] text-text-2">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
            <Button variant="primary" className="mt-7 w-full justify-center" onClick={() => setStep('choose')}>
              Get started <ArrowRight size={14} />
            </Button>
          </div>
        )}

        {step === 'choose' && (
          <div>
            <h2 className="text-center font-[var(--font-display)] text-[22px] font-semibold tracking-[-0.02em]">Choose your first voices</h2>
            <p className="mt-1 text-center text-[13px] text-text-2">You can add or remove models any time from Models.</p>
            <div role="radiogroup" className="mt-6 space-y-3">
              {featured && (
                <Choice selected={pick === featured.id} onSelect={() => setPick(featured.id)}>
                  <ModelArt model={featured} size={48} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[14px] font-semibold">
                      {featured.name} <FitBadge model={featured} />
                    </div>
                    <div className="text-[12px] text-text-2">
                      {featured.voice_count} natural voices · {featured.languages.length} languages · {formatBytes(featured.size_bytes)}
                    </div>
                  </div>
                </Choice>
              )}
              <Choice selected={pick === ''} onSelect={() => setPick('')}>
                <div className="flex size-12 shrink-0 items-center justify-center rounded-[13px] bg-fill-control text-text-2">
                  <Sparkles size={20} strokeWidth={1.6} />
                </div>
                <div>
                  <div className="text-[14px] font-semibold">Just system voices for now</div>
                  <div className="text-[12px] text-text-2">Use the voices built into your computer. No download.</div>
                </div>
              </Choice>
            </div>
            <div className="mt-7 flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep('welcome')}>
                Back
              </Button>
              <Button variant="primary" onClick={start} disabled={download.isPending}>
                {chosen ? `Download ${chosen.name} · ${formatBytes(chosen.size_bytes)}` : 'Continue'} <ArrowRight size={14} />
              </Button>
            </div>
          </div>
        )}

        {step === 'download' && chosen && <Downloading model={chosen} onDone={finish} />}

        <div className="mt-6">
          <Dots step={step} />
        </div>
      </div>
    </div>
  )
}
