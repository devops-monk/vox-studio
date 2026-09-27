import { Link } from '@tanstack/react-router'
import { NAV, SETTINGS_ITEM, type NavItem } from './nav'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/cn'
import { EngineStatus } from './engine-status'

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <Link
      to={item.path}
      activeOptions={{ exact: item.path === '/' }}
      className="no-drag group flex h-7 items-center gap-2.5 rounded-[7px] px-2 text-[13px] text-text-1 outline-none transition-colors duration-100 hover:bg-fill-hover data-[status=active]:bg-fill-active"
    >
      {({ isActive }) => (
        <>
          <Icon
            size={15}
            strokeWidth={1.9}
            className={cn('shrink-0 transition-colors', isActive ? 'text-[var(--accent)]' : 'text-text-2 group-hover:text-text-1')}
          />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </Link>
  )
}

export function Sidebar() {
  return (
    <aside
      aria-label="Main navigation"
      className="flex w-[var(--sidebar-width)] shrink-0 flex-col bg-[var(--glass-0)]"
    >
      {/* Traffic-light gutter doubles as a drag handle */}
      <div data-tauri-drag-region className={cn('shrink-0', isMac ? 'h-[var(--toolbar-height)]' : 'h-3')} />

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {NAV.map((section, i) => (
          <div key={section.title ?? i} className="space-y-px">
            {section.title && (
              <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-text-3">{section.title}</div>
            )}
            {section.items.map((item) => (
              <SidebarLink key={item.path} item={item} />
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t-[0.5px] border-hairline px-3 py-2">
        <SidebarLink item={SETTINGS_ITEM} />
        <EngineStatus />
      </div>
    </aside>
  )
}
