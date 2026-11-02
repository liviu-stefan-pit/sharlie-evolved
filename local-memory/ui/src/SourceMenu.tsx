import { useEffect, useId, useRef, useState } from 'react'
import type { SourceFolder } from './types'

export function SourceMenu({ sources, view }: { sources: SourceFolder[]; view: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    setOpen(false)
  }, [view])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button"
        className="h-9 rounded-full border border-line bg-field px-3 text-[15px] text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        Sources
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Sources"
          className="absolute right-0 z-30 mt-1 max-h-72 w-80 overflow-auto rounded-xl border border-line bg-elevated p-1"
        >
          {sources.length === 0 ? (
            <p className="px-2 py-1.5 text-[13px] text-muted">No source folders</p>
          ) : (
            sources.map((source) => (
              <div
                key={`${source.tool}\0${source.path}`}
                role="presentation"
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-[120ms] hover:bg-white/[0.05]"
              >
                <span className="text-ink">{source.tool}</span>
                <span className="truncate text-muted" title={source.path}>
                  {source.path}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
