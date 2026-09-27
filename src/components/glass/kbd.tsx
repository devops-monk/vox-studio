export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border-[0.5px] border-hairline bg-fill-control px-1 font-sans text-[11px] text-text-2">
      {children}
    </kbd>
  )
}
