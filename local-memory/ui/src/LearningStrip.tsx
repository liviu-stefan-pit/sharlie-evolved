import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { canCancelLearning, cancelLearning } from './host'
import { Trouble } from './Trouble'
import { learnProblem } from './setup'
import type { PageState } from './types'

export type PassEnd = {
  seq: number
  added: number
  error: string
  result: PageState['learningResult']
  nothingNew?: boolean
  /** The start was accepted but no pass ran and the host said neither why nor that it finished. */
  didNotRun?: boolean
  /** The host's code for `error` (learning.errorCode or the reply's errorCode). */
  errorCode?: string
}

type Props = {
  learning: PageState['learning']
  /** The last pass that ended (recorded by the App per snapshot). */
  ended: PassEnd | null
  /** Adopt the snapshot cancelLearning resolves with. */
  onState: (next: PageState) => void
  waiting: boolean
  lines: string[]
  onSeeLessons: () => void
  /** Opens Settings at the AI key (for a missing or unusable key). */
  onOpenSettings?: () => void
  /** Starts another pass (offered after a model error). */
  onRetry?: () => void
}

/** Slim strip under the header: "Learning… 37 of 412 chats", Cancel, then "Done. 58 lessons learned". */
export function LearningStrip({ learning, ended, onState, waiting, lines, onSeeLessons, onOpenSettings, onRetry }: Props) {
  const id = useId()
  const active = waiting || learning?.active === true
  const [done, setDone] = useState<{ text: string; calm?: boolean } | null>(null)
  const [endError, setEndError] = useState('')
  const [endErrorCode, setEndErrorCode] = useState('')
  // The host keeps a failed pass's error on every snapshot until the next pass: let the person close it.
  const [dismissedError, setDismissedError] = useState('')
  const [details, setDetails] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const cancellable = canCancelLearning()

  // `ended` is recorded by the App as snapshots arrive, so a pass that starts and ends between
  // two renders still reports. A refused start never starts a pass, so it never reports Done.
  // Per-pass reset: a new start (waiting) or an active pass clears the last pass's summary and count.
  useEffect(() => {
    if (active) {
      setDone(null)
      setEndError('')
      setEndErrorCode('')
      setDismissedError('')
    }
  }, [active])
  useEffect(() => {
    if (!ended) return
    setCancelling(false)
    setEndError(ended.error)
    setEndErrorCode(ended.errorCode ?? '')
    setDismissedError('')
    const r = ended.result
    if (ended.didNotRun) setDone(null)
    else if (ended.nothingNew) setDone({ text: 'Nothing new to learn', calm: true })
    else if (r?.text) setDone({ text: r.text.startsWith('Learning cancelled') ? r.text : `Done. ${r.text}` })
    else if (!ended.error) setDone({ text: `Done. ${ended.added} ${ended.added === 1 ? 'lesson' : 'lessons'} learned` })
    else setDone(null)
  }, [ended?.seq])

  const logRef = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  useLayoutEffect(() => {
    const node = logRef.current
    if (node && stick.current) node.scrollTop = node.scrollHeight
  }, [lines, details])

  const rawError = learning?.error || endError
  const error = rawError && rawError !== dismissedError ? rawError : ''
  const problem = learnProblem(error, learning?.error ? (learning.errorCode ?? '') : endErrorCode)
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
      setCancelError(e instanceof Error ? e.message : String(e))
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
        {!active && done && !done.calm ? (
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
        {!active && (done || error) ? (
          <button type="button" aria-label="Dismiss" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:text-ink" onClick={() => { setDone(null); if (error) setDismissedError(rawError) }}>
            ×
          </button>
        ) : null}
      </div>
      {cancelError ? <Trouble raw={cancelError} className="px-3 pb-2" /> : null}
      {error && !cancelError ? (
        <p role="alert" className="px-3 pb-2 text-[13px] text-danger">
          {problem.text}
          {problem.settings && onOpenSettings ? (
            <button type="button" className="ml-2 inline-flex h-9 items-center text-[13px] text-ink underline" onClick={onOpenSettings}>
              Open Settings
            </button>
          ) : null}
          {problem.retry && onRetry ? (
            <button type="button" className="ml-2 inline-flex h-9 items-center text-[13px] text-ink underline" onClick={onRetry}>
              Try again
            </button>
          ) : null}
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
