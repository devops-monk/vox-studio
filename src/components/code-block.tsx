import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'

export interface Snippet {
  label: string
  code: string
}

// Strings and comments are tinted; everything else stays plain. Comments need leading whitespace so
// the `//` in an unquoted URL isn't mistaken for one.
const TOKENS = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|(?<=^|\s)(?:#|\/\/)[^\n]*)/g

function Highlighted({ code }: { code: string }) {
  return (
    <>
      {code.split(TOKENS).map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <span key={i} className={/^["']/.test(part) ? 'text-[#30d158] dark:text-[#7ee2a0]' : 'text-text-3 italic'}>
            {part}
          </span>
        ),
      )}
    </>
  )
}

export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
  } catch {
    toast.error('Couldn’t copy to the clipboard')
  }
}

/** Code with language tabs and a copy button. */
export function CodeBlock({ snippets, className }: { snippets: Snippet[]; className?: string }) {
  const [tab, setTab] = useState(0)
  const [copied, setCopied] = useState(false)
  const current = snippets[Math.min(tab, snippets.length - 1)]
  const copy = async () => {
    await copyText(current.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className={cn('overflow-hidden rounded-[var(--radius-md)] border-[0.5px] border-hairline bg-[color-mix(in_srgb,var(--fill-control)_70%,transparent)]', className)}>
      <div className="flex items-center gap-1 border-b-[0.5px] border-hairline px-2 py-1">
        {snippets.length > 1 ? (
          snippets.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setTab(i)}
              className={cn('rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors', i === tab ? 'bg-fill-active text-text-1' : 'text-text-3 hover:text-text-2')}
            >
              {s.label}
            </button>
          ))
        ) : (
          <span className="px-2 text-[11px] font-medium text-text-3">{current.label}</span>
        )}
        <button type="button" onClick={() => void copy()} aria-label="Copy code" className="ml-auto grid size-6 place-items-center rounded-[6px] text-text-3 hover:bg-fill-hover hover:text-text-1">
          {copied ? <Check size={12} className="text-[#30d158]" /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-[var(--font-mono)] text-[11.5px] leading-[1.6] whitespace-pre select-text">
        <Highlighted code={current.code} />
      </pre>
    </div>
  )
}
