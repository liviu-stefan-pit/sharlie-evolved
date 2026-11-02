import { useId, useState } from 'react'

/** Lyra: the one sentence for a thrown host error; the raw text sits under Details. */
export const HOST_TROUBLE = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'

/**
 * Lyra's Details disclosure: collapsed by default, a 36px button with aria-expanded, and the raw
 * text in small monospace that wraps long paths. Renders nothing when there is no raw text.
 */
export function Details({ raw, className = '' }: { raw: string; className?: string }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (!raw.trim()) return null
  return (
    <div className={className} data-details>
      <button
        type="button"
        className="inline-flex h-9 min-w-9 items-center rounded-[10px] px-1 text-[13px] text-muted hover:text-ink"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        Details
      </button>
      {open ? (
        <pre id={id} className="mt-1 max-w-full font-mono text-[12px] leading-[1.5] whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">
          {raw}
        </pre>
      ) : null}
    </div>
  )
}

export function Trouble({ raw, id, className = '' }: { raw: string; id?: string; className?: string }) {
  const own = useId()
  return (
    <div role="alert" id={id ?? own} className={`text-[13px] text-danger ${className}`}>
      <p>{HOST_TROUBLE}</p>
      <Details raw={raw} className="mt-1" />
    </div>
  )
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '')
}

/** Known plain sentences the bridge or host rejects with: shown as-is, no Details. */
const PLAIN = [/^The desktop bridge did not load/, /^Sharlie host is not available$/]

/**
 * Split a host rejection into the plain sentence and the raw detail.
 * - Electron prefixes IPC rejections with "Error invoking remote method 'state': Error: ".
 * - The host's startup sentences end with "(raw detail)".
 * - An error object may carry its own `detail` string.
 * - Anything else is raw text: no sentence of its own, all of it under Details.
 */
export function splitHostError(error: unknown): { sentence: string; detail: string } {
  const own = error && typeof error === 'object' && typeof (error as { detail?: unknown }).detail === 'string' ? ((error as { detail: string }).detail) : ''
  let message = errorText(error).trim()
  message = message.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/, '').trim()
  if (own.trim()) return { sentence: message, detail: own.trim() }
  if (PLAIN.some((rule) => rule.test(message))) return { sentence: message, detail: '' }
  const packed = /^(Sharlie[\s\S]*?[.!?])\s*\(([\s\S]+)\)\s*$/.exec(message)
  if (packed) return { sentence: packed[1]!.trim(), detail: packed[2]!.trim() }
  if (/^Sharlie\b[^\n]*[.!?]$/.test(message)) return { sentence: message, detail: '' }
  return { sentence: '', detail: message }
}
