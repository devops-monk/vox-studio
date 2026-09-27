import { GlassPanel, SegmentedControl } from '@/components/glass'
import { usePrefs, type ThemePref } from '@/lib/store/prefs'
import { useSettings, useSystem, useUpdateSettings } from '@/lib/voxd/queries'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

const DEVICE_LABEL: Record<string, string> = { auto: 'Auto', cpu: 'CPU', mps: 'Apple GPU', cuda: 'NVIDIA GPU' }

function Performance() {
  const system = useSystem().data
  const settings = useSettings().data
  const update = useUpdateSettings()
  if (!system || !settings) return null
  const options = ['auto', ...system.accelerators].map((d) => ({ value: d, label: DEVICE_LABEL[d] ?? d }))
  const inUse = settings.compute_device_in_use
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Performance</h3>
      <GlassPanel className="divide-y-[0.5px] divide-[var(--hairline)]">
        <Row
          label="Compute device"
          hint={`Where voice cloning runs. Auto picks the fastest available.${inUse ? ` Currently using: ${DEVICE_LABEL[inUse] ?? inUse}.` : ''}`}
        >
          <SegmentedControl<string>
            aria-label="Compute device"
            value={settings.compute_device}
            onChange={(v) => update.mutate({ compute_device: v })}
            options={options}
          />
        </Row>
      </GlassPanel>
    </section>
  )
}

/** Settings shell. Appearance lands in M0; remaining sections arrive in M15. */
export function SettingsPage() {
  const { theme, setTheme } = usePrefs()

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-8 py-8">
      <section className="space-y-2">
        <h3 className="px-1 text-[12px] font-semibold tracking-wide text-text-3">Appearance</h3>
        <GlassPanel className="divide-y-[0.5px] divide-[var(--hairline)]">
          <Row label="Theme" hint="Follow macOS, or pick one.">
            <SegmentedControl<ThemePref>
              aria-label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'system', label: 'Auto' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
        </GlassPanel>
      </section>
      <Performance />
      <p className="px-1 text-[12px] text-text-3">Storage, privacy, shortcuts and the rest of settings are coming in M15.</p>
    </div>
  )
}
