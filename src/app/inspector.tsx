import { History } from 'lucide-react'
import { usePrefs } from '@/lib/store/prefs'
import { cn } from '@/lib/cn'

/** Right-hand inspector. Hosts takes history in M7. */
export function Inspector() {
  const open = usePrefs((s) => s.inspectorOpen)
  return (
    <aside
      aria-label="Inspector"
      aria-hidden={!open}
      className={cn(
        'shrink-0 overflow-hidden border-l-[0.5px] border-hairline transition-[width,opacity] duration-300 ease-[var(--ease-spring)]',
        open ? 'w-[300px] opacity-100' : 'w-0 opacity-0',
      )}
    >
      <div className="flex h-full w-[300px] flex-col items-center justify-center gap-2 p-6 text-center text-text-3">
        <History size={28} strokeWidth={1.4} />
        <div className="text-[13px] font-medium text-text-2">No takes yet</div>
        <div className="text-[12px]">Generated audio will appear here.</div>
      </div>
    </aside>
  )
}
