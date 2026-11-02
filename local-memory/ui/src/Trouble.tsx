import { useId } from 'react'

/** Lyra: the one sentence for a thrown host error; the raw text sits under Details. */
export const HOST_TROUBLE = 'Something went wrong on this PC. Try again. If it keeps happening, open Details'

export function Trouble({ raw, id, className = '' }: { raw: string; id?: string; className?: string }) {
  const own = useId()
  return (
    <div role="alert" id={id ?? own} className={`text-[13px] text-danger ${className}`}>
      <p>{HOST_TROUBLE}</p>
      {raw ? (
        <details className="mt-1 text-muted">
          <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-[10px] text-[13px] text-muted hover:text-ink">Details</summary>
          <p className="mt-1 break-words whitespace-pre-wrap">{raw}</p>
        </details>
      ) : null}
    </div>
  )
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '')
}
