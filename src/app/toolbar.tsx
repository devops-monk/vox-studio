import { useRouterState } from '@tanstack/react-router'
import { PanelRight, Search } from 'lucide-react'
import { ALL_NAV_ITEMS } from './nav'
import { Button, Kbd } from '@/components/glass'
import { usePrefs } from '@/lib/store/prefs'
import { usePalette } from './command-palette'
import { Activity } from './activity'

export function Toolbar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = ALL_NAV_ITEMS.find((i) => (i.path === '/' ? pathname === '/' : pathname.startsWith(i.path)))
  const toggleInspector = usePrefs((s) => s.toggleInspector)
  const openPalette = usePalette((s) => s.setOpen)

  return (
    <header
      data-tauri-drag-region
      className="flex h-[var(--toolbar-height)] shrink-0 items-center gap-3 border-b-[0.5px] border-hairline px-4"
    >
      <h1 data-tauri-drag-region className="font-[var(--font-display)] text-[15px] font-semibold tracking-[-0.01em]">
        {current?.label ?? 'VoxStudio'}
      </h1>
      <div data-tauri-drag-region className="flex-1" />
      <button
        type="button"
        onClick={() => openPalette(true)}
        className="no-drag flex h-7 w-56 items-center gap-2 rounded-[8px] bg-fill-control px-2.5 text-[12px] text-text-3 transition-colors hover:bg-fill-hover"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Activity />
      <Button variant="ghost" size="icon" aria-label="Toggle inspector" onClick={toggleInspector}>
        <PanelRight size={16} strokeWidth={1.8} />
      </Button>
    </header>
  )
}
