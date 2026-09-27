import { useEffect } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from '@tanstack/react-router'
import { Monitor, Moon, Sun } from 'lucide-react'
import { create } from 'zustand'
import { ALL_NAV_ITEMS } from './nav'
import { usePrefs, type ThemePref } from '@/lib/store/prefs'

export const usePalette = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Use system appearance', icon: Monitor },
  { value: 'light', label: 'Light appearance', icon: Sun },
  { value: 'dark', label: 'Dark appearance', icon: Moon },
]

const itemClass =
  'flex h-9 cursor-default items-center gap-3 rounded-[8px] px-3 text-[13px] text-text-1 data-[selected=true]:bg-[var(--accent)] data-[selected=true]:text-white [&[data-selected=true]_svg]:text-white [&[data-selected=true]_.hint]:text-white/70'

export function CommandPalette() {
  const { open, setOpen } = usePalette()
  const navigate = useNavigate()
  const setTheme = usePrefs((s) => s.setTheme)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!usePalette.getState().open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const run = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/10 animate-[fade-in_120ms_ease-out]"
      contentClassName="glass-pop fixed left-1/2 top-[14vh] z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[var(--radius-xl)] animate-[pop-in_180ms_var(--ease-spring)]"
    >
      <Command.Input
        autoFocus
        placeholder="Search pages and commands…"
        className="h-12 w-full border-b-[0.5px] border-hairline bg-transparent px-4 text-[15px] text-text-1 outline-none placeholder:text-text-3"
      />
      <Command.List className="max-h-[360px] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-text-3">No results</Command.Empty>
        <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-text-3">
          {ALL_NAV_ITEMS.map((item) => (
            <Command.Item
              key={item.path}
              value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
              onSelect={() => run(() => navigate({ to: item.path }))}
              className={itemClass}
            >
              <item.icon size={16} strokeWidth={1.8} className="text-text-2" />
              <span>{item.label}</span>
              <span className="hint ml-auto truncate text-[12px] text-text-3">{item.description}</span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Appearance" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-text-3">
          {THEMES.map((t) => (
            <Command.Item key={t.value} value={`${t.label} theme`} onSelect={() => run(() => setTheme(t.value))} className={itemClass}>
              <t.icon size={16} strokeWidth={1.8} className="text-text-2" />
              <span>{t.label}</span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
