import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { LessonDetail } from './LessonDetail'
import { FirstRun } from './FirstRun'
import { LearningStrip, type PassEnd } from './LearningStrip'

const learnProblemText = (text: string, code: string) => learnProblem(text, code).text
import { LessonList } from './LessonList'
import { AskPanel, type AskState } from './Ask'
import { Details, splitHostError, Trouble } from './Trouble'
import { cadenceLabel, DID_NOT_RUN, firstTodo, learnProblem, refusalCode, sharingOn } from './setup'
import { filterGraph } from './graph'
import { GraphMap } from './GraphMap'
import { checkSources, loadState, onLearning, runAction, runLookup } from './host'
import { SettingsView } from './SettingsView'
import { applyTheme, readTheme } from './theme'
import { SourceMenu } from './SourceMenu'
import { type GraphNode, type PageState } from './types'

type View = 'graph' | 'settings'


export function App() {
  const [view, setView] = useState<View>('graph')
  const [state, setState] = useState<PageState | null>(null)
  const [hostError, setHostError] = useState<{ sentence: string; detail: string } | null>(null)
  const [query, setQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [ask, setAsk] = useState<AskState>({ phase: 'idle' })
  const askRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [notice, setNotice] = useState('')
  const stateRef = useRef<PageState | null>(null)

  const passStart = useRef(0)
  /** A start was accepted but no pass has shown as active yet (an empty rerun ends without ever being active). */
  const awaitingPass = useRef(false)
  /** learningResult as it stood when this start was pressed; the same result after the pass is the previous pass's. */
  const resultAtStart = useRef('null')
  const fresh = (result: PageState['learningResult'] | undefined) =>
    result && JSON.stringify(result) !== resultAtStart.current ? result : null
  /**
   * A start that ended without an active phase. An error always wins. "Nothing new to learn" only when the
   * host says a pass ran over zero chats: a new learningResult of 0 lessons / 0 chats, or a finished 0 of 0.
   * Anything else (learning null and no new result) means no pass ran: say so, never "Nothing new".
   */
  function endWithoutPass(next: PageState) {
    awaitingPass.current = false
    const error = next.learning?.error || (next.errorCode ? next.notice || next.errorCode : '')
    const result = fresh(next.learningResult)
    const ranEmpty =
      (!!result && result.lessons === 0 && result.chats === 0) ||
      (!result && !!next.learning && !next.learning.active && next.learning.total === 0)
    const end = (patch: Partial<PassEnd>) =>
      setPassEnd((prev) => ({ seq: (prev?.seq ?? 0) + 1, added: 0, error: '', result: null, ...patch }))
    const errorCode = next.learning?.error ? (next.learning.errorCode ?? '') : (next.errorCode ?? '')
    if (error) end({ error: next.errorCode && !next.learning?.error ? learnProblemText(error, next.errorCode) : error, errorCode })
    else if (ranEmpty) end({ nothingNew: true })
    else if (result) end({ result })
    else end({ didNotRun: true, error: DID_NOT_RUN })
  }
  const passError = useRef('')
  const passErrorCode = useRef('')
  const [passEnd, setPassEnd] = useState<PassEnd | null>(null)
  const [ranOnce, setRanOnce] = useState(false)
  const [settingsFocus, setSettingsFocus] = useState<'key' | null>(null)

  const [sessionNew, setSessionNew] = useState<ReadonlySet<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  function adopt(next: PageState) {
    // Cards that appear after the first snapshot are new in this session.
    const before = stateRef.current
    if (before) {
      const known = new Set(before.graph.nodes.map((node) => node.id))
      const fresh = next.graph.nodes.filter((node) => node.kind === 'card' && !known.has(node.id)).map((node) => node.id)
      if (fresh.length > 0) setSessionNew((prev) => new Set([...prev, ...fresh]))
    }
    const wasActive = stateRef.current?.learning?.active === true
    const isActive = next.learning?.active === true
    const cards = next.graph.nodes.filter((node) => node.kind === 'card').length
    if (isActive) awaitingPass.current = false
    // The host had nothing new to read: it reports a finished pass of 0 without an active phase.
    if (!wasActive && !isActive && awaitingPass.current && next.learning) endWithoutPass(next)
    if (!wasActive && isActive) {
      passStart.current = cards
      passError.current = ''
      passErrorCode.current = ''
      setRanOnce(true)
    }
    if (next.learning?.error) {
      passError.current = next.learning.error
      passErrorCode.current = next.learning.errorCode ?? ''
    }
    if (wasActive && !isActive) {
      const error = passError.current
      const errorCode = error ? passErrorCode.current : ''
      const result = fresh(next.learningResult)
      const nothingNew = !error && !!result && result.lessons === 0 && result.chats === 0
      // A failed pass (84fcd42: learning.error + errorCode, plus a 0-lesson result) is never "Done" or "Nothing new".
      const failedEmpty = !!error && (!result || result.lessons === 0)
      setPassEnd((prev) => ({ seq: (prev?.seq ?? 0) + 1, added: Math.max(0, cards - passStart.current), error, errorCode, result: nothingNew || failedEmpty ? null : result, nothingNew }))
    }
    stateRef.current = next
    setState(next)
    setNotice(next.notice ?? '')
  }

  function apply(next: PageState) {
    const current = stateRef.current
    adopt({
      ...next,
      learning: next.learning ?? null,
      graph: {
        ...next.graph,
        nodes: preserveNodeMotion(current?.graph.nodes, next.graph.nodes),
      },
    })
  }

  function applyActionReply(next: PageState) {
    const current = stateRef.current
    const currentLearning = current?.learning
    const replyLearning = next.learning ?? null
    const stale =
      !!currentLearning?.active &&
      !!replyLearning?.active &&
      currentLearning.total === replyLearning.total &&
      currentLearning.done > replyLearning.done
    adopt({
      ...next,
      learning: stale ? currentLearning : replyLearning,
      graph: stale
        ? current!.graph
        : {
            ...next.graph,
            nodes: preserveNodeMotion(current?.graph.nodes, next.graph.nodes),
          },
    })
    setWaiting(false)
  }

  useEffect(() => applyTheme(readTheme()), [])

  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(0)
  const lastRefresh = useRef(0)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancel = false
    loadState()
      .then((next) => {
        if (cancel) return
        setHostError(null)
        lastRefresh.current = Date.now()
        apply(next)
      })
      .catch((error: unknown) => {
        if (!cancel) setHostError(splitHostError(error instanceof Error && error.message ? error : new Error('Sharlie host is not available')))
      })
      .finally(() => {
        if (!cancel) setRetrying(false)
      })
    return () => {
      cancel = true
    }
  }, [attempt])

  // Refresh when the window comes back (focus or visible): folders may have changed meanwhile.
  // At most once per 2s, never during a learning pass or while an action is in flight, and a
  // failed refresh keeps the current screen instead of flashing the service error.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      const current = stateRef.current
      if (!current || current.learning?.active || inFlight.current > 0) return
      const now = Date.now()
      if (now - lastRefresh.current < 2000) return
      lastRefresh.current = now
      loadState()
        .then((next) => {
          if (inFlight.current > 0 || stateRef.current?.learning?.active) return
          apply(next)
        })
        .catch(() => {})
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  async function tracked<T>(run: () => Promise<T>) {
    inFlight.current += 1
    try {
      return await run()
    } finally {
      inFlight.current -= 1
    }
  }

  function retryHost() {
    setRetrying(true)
    setAttempt((value) => value + 1)
  }

  useEffect(() => {
    return onLearning((incoming) => {
      apply(incoming)
      if (incoming.learning) setWaiting(false)
    })
  }, [])

  const graph = state?.graph
  const visible = useMemo(() => (graph ? filterGraph(graph, query) : null), [graph, query])
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null
  const cardCount = graph?.nodes.filter((node) => node.kind === 'card').length ?? 0
  const active = waiting || state?.learning?.active === true
  const [noWebgl, setNoWebgl] = useState(false)
  const [layout, setLayout] = useState<'map' | 'list'>('map')
  const narrow = useNarrow()
  const closeDetail = useCallback(() => setSelectedId(''), [])
  function detail(node: GraphNode, sheet: boolean) {
    return (
      <LessonDetail
        key={sheet ? 'sheet' : 'panel'}
        node={node}
        nodes={graph?.nodes ?? []}
        links={graph?.links ?? []}
        sheet={sheet}
        share={sharingOn(state)}
        onOpen={openLesson}
        onClose={closeDetail}
      />
    )
  }
  const empty = !!state && state.graph.nodes.length === 0 && !active
  const ready = !!state && firstTodo(state) === null
  const finishedRun =
    !!state &&
    !state.learning?.error &&
    (ranOnce || state.learning?.active === false || state.ingest?.visible === true || !!state.learningResult)
  // A finished run that found nothing gets the Home empty state, never a blank graph.
  const homeEmpty = empty && ready && finishedRun
  const firstRun = empty && !homeEmpty

  async function checkAgain() {
    apply(await tracked(checkSources))
  }

  const [checkingHome, setCheckingHome] = useState(false)
  const [homeTrouble, setHomeTrouble] = useState('')
  const homeBusy = useRef(false)
  async function checkHome() {
    if (homeBusy.current) return
    homeBusy.current = true
    setCheckingHome(true)
    setHomeTrouble('')
    try {
      await checkAgain()
    } catch (error) {
      setHomeTrouble(error instanceof Error ? error.message : String(error))
    } finally {
      homeBusy.current = false
      setCheckingHome(false)
    }
  }

  /** Runs one action and adopts its reply; throws so callers can show the error inline. */
  async function act(body: Record<string, unknown>) {
    const next = await tracked(() => runAction(body))
    apply(next)
    return stateRef.current ?? next
  }

  // Same-tick submits see the same render, so one lookup at a time is guarded by a ref.
  const askBusy = useRef(false)
  async function submitAsk(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (asked === '' || ask.phase === 'asking' || askBusy.current) {
      askRef.current?.focus()
      return
    }
    if (cardCount === 0) {
      setAsk({ phase: 'empty-lessons', question: asked })
      return
    }
    askBusy.current = true
    setAsk({ phase: 'asking', question: asked })
    try {
      const result = await runLookup(asked)
      setAsk({ phase: 'answered', question: asked, answer: result.answer ?? '', cited: Array.isArray(result.cited) ? result.cited : [] })
    } catch (error) {
      setAsk({ phase: 'failed', question: asked, raw: error instanceof Error ? error.message : String(error) })
    } finally {
      askBusy.current = false
    }
  }

  function openLesson(id: string) {
    // A cited lesson hidden by the filter still opens: clear the filter first.
    if (visible && !visible.nodes.some((node) => node.id === id)) setQuery('')
    setView('graph')
    setSelectedId(id)
  }


  const [startRefusal, setStartRefusal] = useState<{ code: string; notice: string } | null>(null)
  const [startTrouble, setStartTrouble] = useState('')

  // Same-tick clicks see the same render, so one start at a time is guarded by a ref.
  const startBusy = useRef(false)
  async function startLearning() {
    if (startBusy.current || stateRef.current?.learning?.active === true) return
    startBusy.current = true
    awaitingPass.current = true
    resultAtStart.current = JSON.stringify(stateRef.current?.learningResult ?? null)
    setWaiting(true)
    setStartRefusal(null)
    setStartTrouble('')
    try {
      const next = await tracked(() => runAction({ action: 'start-learning' }))
      // A refused start (no chats, profile incomplete...) never counts as a run.
      if (next.notice && !next.learning?.active) {
        awaitingPass.current = false
        setStartRefusal({ code: refusalCode(next.errorCode, next.notice), notice: next.notice })
        apply({ ...next, notice: '' })
        setWaiting(false)
        return
      }
      applyActionReply(next)
      // A reply that shows no running pass (learning null, or finished 0 of 0) leaves nothing to wait for:
      // a real pass is already active in the start reply.
      if (!next.learning?.active) {
        if (awaitingPass.current) endWithoutPass(next)
        setWaiting(false)
      }
    } catch (error) {
      awaitingPass.current = false
      setStartTrouble(error instanceof Error ? error.message : String(error))
      setWaiting(false)
    } finally {
      startBusy.current = false
    }
  }

  /** Home's Learn now: with no key saved it opens Settings at the AI key; otherwise the same start as first run. */
  function learnNow() {
    const current = stateRef.current
    if (!current || active) return
    if (!current.hasKey || current.savedProviders.length === 0) {
      setSettingsFocus('key')
      setView('settings')
      return
    }
    void startLearning()
  }
  // Only the host's own record of a finished pass: a click or a failed start never moves "last learned".
  const learnedAt = state?.lastLearnedAt ? Date.parse(state.lastLearnedAt) : null
  const learnNowButton = (
    <button
      type="button"
      className="h-9 shrink-0 rounded-[10px] border border-border-input px-3 text-[13px] text-ink transition-colors duration-[120ms] hover:bg-field disabled:opacity-50"
      disabled={active}
      aria-describedby={active ? 'learn-now-why' : undefined}
      onClick={learnNow}
    >
      Learn now
      {active ? <span id="learn-now-why" className="sr-only"> (learning is already running)</span> : null}
    </button>
  )
  const refusalInStrip = !!startRefusal && !!state?.learning?.error && state.learning.error === startRefusal.notice
  const homeProblem = !firstRun && ((startRefusal && !refusalInStrip) || startTrouble) ? (
    <div className="shrink-0 border-b border-line bg-canvas px-3 py-2">
      {startRefusal && !refusalInStrip ? (
        <p role="alert" className="text-[13px] text-danger">
          {learnProblem(startRefusal.notice, startRefusal.code).text}
          {learnProblem(startRefusal.notice, startRefusal.code).settings || startRefusal.code === 'profile_incomplete' ? (
            <button type="button" className="ml-2 inline-flex h-9 items-center text-[13px] text-ink underline" onClick={() => { setSettingsFocus(startRefusal.code === 'profile_incomplete' ? null : 'key'); setView('settings') }}>
              Open Settings
            </button>
          ) : null}
        </p>
      ) : null}
      {startTrouble ? <Trouble raw={startTrouble} /> : null}
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <h1 className="shrink-0 text-[13px] font-semibold">{state?.title ?? 'Sharlie'}</h1>
        <StatusDot state={state} active={active} learnedAt={learnedAt ?? null} now={now} />
        <form role="search" aria-label="Ask Sharlie" className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => void submitAsk(event)}>
          <input
            ref={askRef}
            className="h-9 w-full min-w-0 rounded-full border border-border-input bg-field px-3 text-[15px] text-ink transition-colors duration-[120ms] placeholder:text-muted hover:bg-white/[0.05]"
            aria-label="Ask Sharlie"
            placeholder="Ask Sharlie"
            enterKeyHint="send"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="hidden h-9 shrink-0 rounded-full border border-accent bg-accent px-3 text-[15px] text-on-accent disabled:opacity-60 sm:inline-block" disabled={ask.phase === 'asking'}>
            Ask
          </button>
        </form>
        <SourceMenu sources={state?.sources ?? []} view={view} />
        <button
          type="button"
          className={`relative h-9 shrink-0 rounded-full border px-3 text-[15px] text-ink transition-colors duration-[120ms] ${view === 'settings' ? 'border-border-input bg-white/[0.08]' : 'border-line bg-field hover:bg-white/[0.05]'}`}
          aria-pressed={view === 'settings'}
          onClick={() => {
            setSettingsFocus(null)
            setView((current) => (current === 'settings' ? 'graph' : 'settings'))
          }}
        >
          Settings
          {view === 'settings' ? <span aria-hidden="true" data-active-mark className="absolute inset-x-3 -bottom-[7px] h-0.5 rounded-full bg-focus" /> : null}
        </button>
      </header>
      {state ? (
        <LearningStrip
          learning={state.learning ?? null}
          ended={passEnd}
          onState={applyActionReply}
          waiting={waiting}
          lines={state.ingest?.visible ? state.ingest.lines : []}
          onOpenSettings={() => {
            setSettingsFocus('key')
            setView('settings')
          }}
          onRetry={learnNow}
          onSeeLessons={() => {
            setQuery('')
            setView('graph')
          }}
        />
      ) : null}
      <AskPanel ask={ask} nodes={graph?.nodes ?? []} onOpen={openLesson} onClose={() => setAsk({ phase: 'idle' })} onStartLearning={() => { setAsk({ phase: 'idle' }); setView('graph') }} />
      {!state && hostError ? <ServiceDown error={hostError} retrying={retrying} onRetry={retryHost} /> : null}
      {!state && !hostError ? <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p> : null}
      {view === 'graph' && visible ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {!firstRun && !homeEmpty && state ? (
            <HomeBar layout={noWebgl ? 'list' : layout} canMap={!noWebgl} onLayout={setLayout} count={cardCount} action={learnNowButton}>
              <input
                type="search"
                aria-label="Filter lessons"
                placeholder="Filter"
                className="h-9 w-full max-w-[220px] rounded-[10px] max-[479.98px]:max-w-none border border-border-input bg-field px-3 text-[13px] text-ink placeholder:text-muted"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query !== '') {
                    event.preventDefault()
                    setQuery('')
                  }
                }}
              />
            </HomeBar>
          ) : null}
          {homeProblem}
          <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {noWebgl || layout === 'list' ? (
              <LessonList
                nodes={visible.nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                note={noWebgl ? "This PC can't draw the map, so here is the list." : undefined}
                sessionNew={sessionNew}
                now={now}
              />
            ) : (
              <GraphMap
                graph={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                learningActive={active}
                onUnsupported={() => setNoWebgl(true)}
                sessionNew={sessionNew}
                now={now}
              />
            )}
            {!firstRun && !homeEmpty && query.trim() !== '' && visible.nodes.length === 0 ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-canvas px-6 text-center">
                <p className="text-[15px] text-ink">No lessons match “{query.trim()}”.</p>
                <button type="button" className="h-9 rounded-[10px] border border-border-input px-3 text-[15px] text-ink hover:bg-field" onClick={() => setQuery('')}>
                  Clear filter
                </button>
              </div>
            ) : null}
            {homeEmpty ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
                <p className="text-[18px] text-ink">No lessons yet. Sharlie will learn as you work.</p>
                <button
                  type="button"
                  className="h-10 rounded-[10px] border border-accent bg-accent px-4 text-[15px] font-medium text-on-accent"
                  disabled={checkingHome}
                  onClick={() => void checkHome()}
                >
                  {checkingHome ? 'Checking' : 'Check again'}
                </button>
                {learnNowButton}
                {homeTrouble ? <Trouble raw={homeTrouble} className="max-w-md" /> : null}
              </div>
            ) : null}
            {firstRun && state ? (
              <div tabIndex={-1} data-first-run-scroll className="absolute inset-0 overflow-auto bg-canvas">
                <FirstRun
                  state={state}
                  act={act}
                  starting={waiting}
                  startError={startTrouble}
                  refusal={startRefusal}
                  onStart={() => void startLearning()}
                  onOpenSettings={() => setView('settings')}
                  onCheckAgain={checkAgain}
                />
              </div>
            ) : null}
            {selected && narrow ? detail(selected, true) : null}
          </div>
          {selected && !narrow ? detail(selected, false) : null}
          </div>
        </div>
      ) : null}
      {view === 'settings' && state ? (
        <SettingsView state={state} act={act} focusSection={settingsFocus} />
      ) : null}
      {view === 'graph' && state && !visible ? (
        <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p>
      ) : null}
    </div>
  )
}

/** Under 760px the lesson opens as a bottom sheet, otherwise as a side panel. */
function useNarrow() {
  const query = '(max-width: 759.98px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

/** Never claims learning is on when nothing is set up. */
function StatusDot({ state, active, learnedAt, now }: { state: PageState | null; active: boolean; learnedAt: number | null; now: number }) {
  const setUp = !!state && firstTodo(state) === null
  const [label, tone] = !state
    ? ['Starting', 'border border-faint']
    : active
      ? ['Learning now', 'bg-amber']
      : !setUp
        ? ['Not set up yet', 'border border-faint']
        : state.paused
          ? ['Learning paused', 'bg-muted']
          : [statusLabel(state, learnedAt, now), 'bg-synced']
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={label}>
      <span role="img" aria-label={label} className={`inline-block h-2 w-2 rounded-full ${tone}`} />
      <span className="hidden text-[13px] text-muted md:inline">{label}</span>
    </span>
  )
}

/** "Last learned 5 min ago" once a pass has ended; manual or scheduled modes keep their wording in front. */
function statusLabel(state: PageState, learnedAt: number | null, now: number) {
  const base = cadenceLabel(state)
  if (learnedAt == null || !Number.isFinite(learnedAt)) return base
  const ago = relativeTime(learnedAt, now)
  if (state.cadence !== 'manual' && state.scheduled !== true) return `Last learned ${ago}`
  return `${base} · last learned ${ago}`
}

function relativeTime(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function HomeBar({ layout, canMap, onLayout, count, action, children }: { layout: 'map' | 'list'; canMap: boolean; onLayout: (next: 'map' | 'list') => void; count: number; action?: ReactNode; children?: ReactNode }) {
  const option = (value: 'map' | 'list', text: string) => (
    <button
      type="button"
      aria-pressed={layout === value}
      disabled={value === 'map' && !canMap}
      className={`h-9 rounded-[8px] px-3 text-[13px] transition-colors duration-[120ms] disabled:opacity-50 ${layout === value ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
      onClick={() => onLayout(value)}
    >
      {text}
    </button>
  )
  return (
    // Under 480px the bar wraps: Filter takes its own full-width row so it never shrinks to a letter.
    <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-canvas px-3 py-1.5">
      <p className="shrink-0 text-[13px] text-muted">{count === 1 ? '1 lesson' : `${count} lessons`}</p>
      {action}
      <div className="min-w-[120px] flex-1 max-[479.98px]:order-last max-[479.98px]:basis-full">{children}</div>
      <div role="group" aria-label="View" className="ml-auto flex shrink-0 items-center rounded-[10px] bg-field p-0.5">
        {option('map', 'Map')}
        {option('list', 'List')}
      </div>
    </div>
  )
}

function ServiceDown({ error, retrying, onRetry }: { error: { sentence: string; detail: string }; retrying: boolean; onRetry: () => void }) {
  // The host's own sentence already says what to do; only add the generic line when it doesn't.
  const guided = /retry/i.test(error.sentence)
  return (
    <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-[13px] font-semibold text-ink">Sharlie couldn't start its background service</h2>
      {error.sentence ? <p className="max-w-md text-[15px] break-words text-ink">{error.sentence}</p> : null}
      {guided ? null : (
        <p className="max-w-md text-[13px] text-muted">
          Retry below. If it keeps failing, quit Sharlie from the tray icon and open it again.
        </p>
      )}
      <button
        type="button"
        className="min-h-11 rounded-full border border-accent bg-accent px-4 py-1.5 text-[15px] font-medium text-on-accent transition-colors duration-[120ms] focus:border-focus disabled:opacity-50"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying' : 'Retry'}
      </button>
      <Details raw={error.detail} className="w-full max-w-md text-left" />
    </div>
  )
}

function preserveNodeMotion(previous: GraphNode[] | undefined, incoming: GraphNode[]) {
  if (!previous || previous.length === 0) return incoming
  const prior = new Map(previous.map((node) => [node.id, node]))
  return incoming.map((node) => {
    const old = prior.get(node.id)
    if (!old) return node
    const next = { ...node }
    if (old.x != null) next.x = old.x
    if (old.y != null) next.y = old.y
    if (old.vx != null) next.vx = old.vx
    if (old.vy != null) next.vy = old.vy
    return next
  })
}

