import { useState } from 'react'
import { Code2, Cpu, HardDrive, Info, Keyboard, Mic, Palette, ScrollText, Settings2, Shield, Boxes, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DictationSettings } from './dictation-settings'
import { About, Appearance, General, Logs, Performance, Privacy, Shortcuts, Storage, VoicesModels } from './sections'
import { useNavigate } from '@tanstack/react-router'

type SectionId = 'general' | 'appearance' | 'models' | 'performance' | 'storage' | 'dictation' | 'shortcuts' | 'privacy' | 'developer' | 'logs' | 'about'

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; tint: string }[] = [
  { id: 'general', label: 'General', icon: Settings2, tint: '#8e8e93' },
  { id: 'appearance', label: 'Appearance', icon: Palette, tint: '#0a84ff' },
  { id: 'models', label: 'Voices & Models', icon: Boxes, tint: '#bf5af2' },
  { id: 'performance', label: 'Performance', icon: Cpu, tint: '#ff9f0a' },
  { id: 'storage', label: 'Storage', icon: HardDrive, tint: '#30d158' },
  { id: 'dictation', label: 'Dictation', icon: Mic, tint: '#ff375f' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, tint: '#5e5ce6' },
  { id: 'privacy', label: 'Privacy', icon: Shield, tint: '#0a84ff' },
  { id: 'developer', label: 'Developer', icon: Code2, tint: '#64d2ff' },
  { id: 'logs', label: 'Logs', icon: ScrollText, tint: '#8e8e93' },
  { id: 'about', label: 'About', icon: Info, tint: '#8e8e93' },
]

let remembered: SectionId = 'general'

export function SettingsPage() {
  const [section, setSectionState] = useState<SectionId>(remembered)
  const navigate = useNavigate()
  const setSection = (id: SectionId) => {
    if (id === 'developer') return void navigate({ to: '/developer' })
    remembered = id
    setSectionState(id)
  }
  const active = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="mx-auto flex max-w-4xl gap-6 px-8 py-8">
      <nav aria-label="Settings sections" className="w-48 shrink-0 space-y-0.5">
        <h2 className="px-2 pb-3 font-[var(--font-display)] text-[22px] font-bold tracking-[-0.02em]">Settings</h2>
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === section}
              onClick={() => setSection(s.id)}
              className={cn('flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors', s.id === section ? 'bg-fill-active font-medium' : 'hover:bg-fill-hover')}
            >
              <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] text-white" style={{ background: s.tint }}>
                <Icon size={13} />
              </span>
              {s.label}
            </button>
          )
        })}
      </nav>
      <div key={section} className="min-w-0 flex-1 space-y-6 animate-[pop-in_220ms_var(--ease-spring)_both]">
        <h3 className="pt-1 font-[var(--font-display)] text-[20px] font-semibold tracking-[-0.015em]">{active.label}</h3>
        {section === 'general' && <General />}
        {section === 'appearance' && <Appearance />}
        {section === 'models' && <VoicesModels />}
        {section === 'performance' && <Performance />}
        {section === 'storage' && <Storage />}
        {section === 'dictation' && <DictationSettings />}
        {section === 'shortcuts' && <Shortcuts onDictation={() => setSection('dictation')} />}
        {section === 'privacy' && <Privacy />}
        {section === 'logs' && <Logs />}
        {section === 'about' && <About />}
      </div>
    </div>
  )
}
