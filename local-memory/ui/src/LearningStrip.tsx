import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { canCancelLearning, cancelLearning } from './host'
import type { PageState } from './types'

type Props = {
  learning: PageState['learning']
  /** docs/HOST_ACTIONS.md learningResult: set when a pass finishes or is cancelled. */
  result?: PageState['learningResult']
  /** Adopt the snapshot cancelLearning resolves with. */
  onState: (next: PageState) => void
  waiting: boolean
  lines: string[]
  /** Lesson cards in the graph right now (to report how many a run added). */
  cardCount: number
  onSeeLessons: () => void
}

/** Slim strip under the header: "Learning… 37 of 412 chats", Cancel, then "Done. 58 lessons learned". */
export function LearningStrip({ learning, result, onState, waiting, lines, cardCount, onSeeLessons }: Props) {
  const id = useId()
  const active = waiting || learning?.active === true
  const startCards = useRef<number | null>(null)
  const [done, setDone] = useState<{ text: string } | null>(null)
  const lastError = useRef('')
  if (learning?.error) lastError.current = learning.error
  // The host clears `learning` after the last event, so keep its error visible after the pass ends.
  const [endError, setEndError] = useState('')
  const resultRef = useRef(result)
  resultRef.current = result
  const [details, setDetails] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const cancellable = canCancelLearning()

  useEffect(() => {
    if (active) {
      if (startCards.current === null) {
        startCards.current = cardCount
        lastError.current = learning?.error ?? ''
        setEndError('')
      }
      setDone(null)
      return
    }
    if (startCards.current !== null) {
      // A run just ended. Report it unless it stopped on an error (the error stays visible).
      const added = Math.max(0, cardCount - startCards.current)
      startCards.current = null
      setCancelling(false)
      setEndError(lastError.current)
      const r = resultRef.current
      if (r?.text) setDone({ text: r.text.startsWith('Learning cancelled') ? r.text : `Done. ${r.text}` })
      else if (!lastError.current) setDone({ text: `Done. ${added} ${added === 1 ? 'lesson' : 'lessons'} learned` })
    }
  }, [active, cardCount, learning?.error])

  const logRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  useLayoutEffect(() => {
    const node = logRef.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [lines, details])

  const error = learning?.error || endError
  if (!active && !done && !error && lines.length === 0) return null

  const total = learning?.total ?? 0
  const count = learning?.done ?? 0
  const known = active && total > 0
  const label = !active
    ? done
      ? done.text
      : error
        ? 'Learning stopped'
        : 'Learning finished'
    : known
      ? `Learning… ${count} of ${total} chats`
      : waiting && !learning?.active
        ? 'Starting to learn…'
        : 'Learning…'
  const step = active ? (lines[lines.length - 1] ?? '') : ''

  async function cancel() {
    setCancelling(true)
    setCancelError('')
    try {
      const next = await cancelLearning()
      if (next && typeof next === 'object' && 'graph' in next) onState(next)
    } catch (e) {
      setCancelling(false)
      setCancelError(e instanceof Error ? e.message : 'Could not cancel')
    }
  }

  return (
    <section aria-labelledby={`${id}-label`} className="shrink-0 border-b border-line bg-panel">
      {active ? (
        <div
          role="progressbar"
          aria-labelledby={`${id}-label`}
          aria-valuemin={known ? 0 : undefined}
          aria-valuemax={known ? total : undefined}
          aria-valuenow={known ? count : undefined}
          className="h-1 overflow-hidden bg-field"
        >
          {known ? (
            <div className="h-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${(count / total) * 100}%` }} />
          ) : (
            <div className="animate-indeterminate h-full w-1/3 bg-accent" />
          )}
        </div>
      ) : null}
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <p id={`${id}-label`} role="status" className="text-[15px] text-ink">
          {label}
        </p>
        {step ? <p className="min-w-0 flex-1 truncate text-[13px] text-muted" title={step}>{step}</p> : <span className="flex-1" />}
        {!active && done ? (
          <button type="button" className="h-9 rounded-[10px] px-2 text-[15px] text-focus underline-offset-2 hover:underline" onClick={() => { setDone(null); onSeeLessons() }}>
            See what I know
          </button>
        ) : null}
        {lines.length > 0 ? (
          <button type="button" className="h-9 rounded-[10px] px-2 text-[13px] text-muted hover:text-ink" aria-expanded={details} aria-controls={`${id}-log`} onClick={() => setDetails((v) => !v)}>
            {details ? 'Hide details' : 'Details'}
          </button>
        ) : null}
        {active && cancellable ? (
          <button type="button" className="h-9 rounded-[10px] border border-border-input px-3 text-[15px] text-ink disabled:opacity-60" disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling' : 'Cancel'}
          </button>
        ) : null}
        {!active && done ? (
          <button type="button" aria-label="Dismiss" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:text-ink" onClick={() => setDone(null)}>
            ×
          </button>
        ) : null}
      </div>
      {error || cancelError ? (
        <p role="alert" className="px-3 pb-2 text-[13px] text-danger">
          {cancelError || error}
        </p>
      ) : null}
      {details && lines.length > 0 ? (
        <div
          id={`${id}-log`}
          ref={logRef}
          role="log"
          aria-label="Learning log"
          className="max-h-32 overflow-auto px-3 pb-2"
          onScroll={(e) => {
            const n = e.currentTarget
            stick.current = n.scrollHeight - n.scrollTop - n.clientHeight <= 24
          }}
        >
          {lines.map((line, index) => (
            <p key={`${index}:${line}`} className="py-0.5 text-[13px] text-muted">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  )
}
