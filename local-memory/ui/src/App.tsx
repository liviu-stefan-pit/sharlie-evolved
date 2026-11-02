import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { LessonDetail } from './LessonDetail'
import { FirstRun } from './FirstRun'
import { LearningStrip, type PassEnd } from './LearningStrip'
import { LessonList } from './LessonList'
import { AskPanel, type AskState } from './Ask'
import { Trouble } from './Trouble'
import { firstTodo } from './setup'
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
  const [hostError, setHostError] = useState('')
  const [query, setQuery] = useState('')
  const [question, setQuestion] = useState('')
  const [ask, setAsk] = useState<AskState>({ phase: 'idle' })
  const askRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [notice, setNotice] = useState('')
  const stateRef = useRef<PageState | null>(null)

  const passStart = useRef(0)
  const passError = useRef('')
  const [passEnd, setPassEnd] = useState<PassEnd | null>(null)
  const [ranOnce, setRanOnce] = useState(false)

  function adopt(next: PageState) {
    const wasActive = stateRef.current?.learning?.active === true
    const isActive = next.learning?.active === true
    const cards = next.graph.nodes.filter((node) => node.kind === 'card').length
    if (!wasActive && isActive) {
      passStart.current = cards
      passError.current = ''
      setRanOnce(true)
    }
    if (next.learning?.error) passError.current = next.learning.error
    if (wasActive && !isActive) {
      const error = passError.current
      setPassEnd((prev) => ({ seq: (prev?.seq ?? 0) + 1, added: Math.max(0, cards - passStart.current), error, result: next.learningResult ?? null }))
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
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    let cancel = false
    loadState()
      .then((next) => {
        if (cancel) return
        setHostError('')
        apply(next)
      })
      .catch((error: unknown) => {
        if (!cancel) setHostError(error instanceof Error && error.message ? error.message : 'Sharlie host is not available')
      })
      .finally(() => {
        if (!cancel) setRetrying(false)
      })
    return () => {
      cancel = true
    }
  }, [attempt])

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
    apply(await checkSources())
  }

  const [checkingHome, setCheckingHome] = useState(false)
  const [homeTrouble, setHomeTrouble] = useState('')
  async function checkHome() {
    setCheckingHome(true)
    setHomeTrouble('')
    try {
      await checkAgain()
    } catch (error) {
      setHomeTrouble(error instanceof Error ? error.message : String(error))
    } finally {
      setCheckingHome(false)
    }
  }

  /** Runs one action and adopts its reply; throws so callers can show the error inline. */
  async function act(body: Record<string, unknown>) {
    const next = await runAction(body)
    apply(next)
    return stateRef.current ?? next
  }

  async function submitAsk(event: FormEvent) {
    event.preventDefault()
    const asked = question.trim()
    if (asked === '' || ask.phase === 'asking') {
      askRef.current?.focus()
      return
    }
    if (cardCount === 0) {
      setAsk({ phase: 'empty-lessons', question: asked })
      return
    }
    setAsk({ phase: 'asking', question: asked })
    try {
      const result = await runLookup(asked)
      setAsk({ phase: 'answered', question: asked, answer: result.answer ?? '', cited: Array.isArray(result.cited) ? result.cited : [] })
    } catch (error) {
      setAsk({ phase: 'failed', question: asked, raw: error instanceof Error ? error.message : String(error) })
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

  async function startLearning() {
    setWaiting(true)
    setStartRefusal(null)
    setStartTrouble('')
    try {
      const next = await runAction({ action: 'start-learning' })
      // A refused start (no chats, profile incomplete...) never counts as a run.
      if (next.notice && !next.learning?.active) {
        setStartRefusal({ code: next.errorCode ?? '', notice: next.notice })
        apply({ ...next, notice: '' })
        setWaiting(false)
        return
      }
      applyActionReply(next)
    } catch (error) {
      setStartTrouble(error instanceof Error ? error.message : String(error))
      setWaiting(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <h1 className="shrink-0 text-[13px] font-semibold">{state?.title ?? 'Sharlie'}</h1>
        <StatusDot state={state} active={active} />
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
          className={`h-9 shrink-0 rounded-full border px-3 text-[15px] transition-colors duration-[120ms] ${view === 'settings' ? 'border-accent bg-accent text-on-accent' : 'border-line bg-field text-ink hover:bg-white/[0.05]'}`}
          aria-pressed={view === 'settings'}
          onClick={() => setView((current) => (current === 'settings' ? 'graph' : 'settings'))}
        >
          Settings
        </button>
      </header>
      {state ? (
        <LearningStrip
          learning={state.learning ?? null}
          ended={passEnd}
          onState={applyActionReply}
          waiting={waiting}
          lines={state.ingest?.visible ? state.ingest.lines : []}
          onSeeLessons={() => {
            setQuery('')
            setView('graph')
          }}
        />
      ) : null}
      <AskPanel ask={ask} nodes={graph?.nodes ?? []} onOpen={openLesson} onClose={() => setAsk({ phase: 'idle' })} onStartLearning={() => { setAsk({ phase: 'idle' }); setView('graph') }} />
      {!state && hostError ? <ServiceDown detail={hostError} retrying={retrying} onRetry={retryHost} /> : null}
      {!state && !hostError ? <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p> : null}
      {view === 'graph' && visible ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {!firstRun && !homeEmpty && state ? (
            <HomeBar layout={noWebgl ? 'list' : layout} canMap={!noWebgl} onLayout={setLayout} count={cardCount}>
              <input
                type="search"
                aria-label="Filter lessons"
                placeholder="Filter"
                className="h-9 w-full max-w-[220px] rounded-[10px] border border-border-input bg-field px-3 text-[13px] text-ink placeholder:text-muted"
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
          <div className="flex min-h-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {noWebgl || layout === 'list' ? (
              <LessonList
                nodes={visible.nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                note={noWebgl ? "This PC can't draw the map, so here is the list." : undefined}
              />
            ) : (
              <GraphMap
                graph={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                learningActive={active}
                onUnsupported={() => setNoWebgl(true)}
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
                {homeTrouble ? <Trouble raw={homeTrouble} className="max-w-md" /> : null}
              </div>
            ) : null}
            {firstRun && state ? (
              <div className="absolute inset-0 overflow-auto bg-canvas">
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
        <SettingsView state={state} act={act} />
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
function StatusDot({ state, active }: { state: PageState | null; active: boolean }) {
  const setUp = !!state && firstTodo(state) === null
  const [label, tone] = !state
    ? ['Starting', 'border border-faint']
    : active
      ? ['Learning now', 'bg-amber']
      : !setUp
        ? ['Not set up yet', 'border border-faint']
        : state.paused
          ? ['Learning paused', 'bg-muted']
          : state.cadence === 'manual'
            ? ['Learns when you ask', 'bg-synced']
            : ['Learns every hour', 'bg-synced']
  return (
    <span className="flex shrink-0 items-center gap-1.5" title={label}>
      <span role="img" aria-label={label} className={`inline-block h-2 w-2 rounded-full ${tone}`} />
      <span className="hidden text-[13px] text-muted md:inline">{label}</span>
    </span>
  )
}

function HomeBar({ layout, canMap, onLayout, count, children }: { layout: 'map' | 'list'; canMap: boolean; onLayout: (next: 'map' | 'list') => void; count: number; children?: ReactNode }) {
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
    <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 py-1.5">
      <p className="shrink-0 text-[13px] text-muted">{count === 1 ? '1 lesson' : `${count} lessons`}</p>
      <div className="min-w-0 flex-1">{children}</div>
      <div role="group" aria-label="View" className="flex shrink-0 items-center rounded-[10px] bg-field p-0.5">
        {option('map', 'Map')}
        {option('list', 'List')}
      </div>
    </div>
  )
}

function ServiceDown({ detail, retrying, onRetry }: { detail: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-[13px] font-semibold text-ink">Sharlie couldn't start its background service</h2>
      <p className="max-w-md text-[13px] break-words text-pending">{detail}</p>
      <p className="max-w-md text-[13px] text-muted">
        Retry below. If it keeps failing, quit Sharlie from the tray icon and open it again.
      </p>
      <button
        type="button"
        className="min-h-8 rounded-full border border-accent bg-accent px-4 py-1.5 text-[13px] font-medium text-on-accent transition-colors duration-[120ms] focus:border-focus disabled:opacity-50"
        disabled={retrying}
        onClick={onRetry}
      >
        {retrying ? 'Retrying' : 'Retry'}
      </button>
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

