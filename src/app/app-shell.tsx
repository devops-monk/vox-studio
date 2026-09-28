import { Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { Sidebar } from './sidebar'
import { Toolbar } from './toolbar'
import { Inspector } from './inspector'
import { CommandPalette } from './command-palette'
import { EngineGate } from './engine-gate'
import { Onboarding } from '@/features/onboarding/onboarding'
import { useApplyAppearance, useApplyTheme } from '@/lib/use-theme'
import { useAppShortcuts, useStartPage } from './shortcuts'
import { useDesktopIntegration } from './desktop'
import { usePrefs } from '@/lib/store/prefs'
import { useEffect } from 'react'
import { dictation } from '@/lib/dictation'

export function AppShell() {
  useApplyTheme()
  useApplyAppearance()
  useAppShortcuts()
  useStartPage()
  useDesktopIntegration()
  const theme = usePrefs((s) => s.theme)
  const shortcut = usePrefs((s) => s.dictation.shortcut)

  // The shell registers the default shortcut at launch; apply the user's choice if different.
  useEffect(() => {
    if (dictation.available && shortcut !== 'CommandOrControl+Shift+Space') void dictation.setShortcut(shortcut).catch(() => {})
  }, [shortcut])

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--glass-1)] shadow-[-0.5px_0_0_var(--hairline)]">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          <Inspector />
        </div>
      </div>
      <CommandPalette />
      <EngineGate />
      <Onboarding />
      <Toaster position="bottom-right" theme={theme} />
    </div>
  )
}
