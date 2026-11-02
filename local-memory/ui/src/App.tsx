import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Drawer } from './Drawer'
import { FirstRun } from './FirstRun'
import { LearningStrip } from './LearningStrip'
import { LessonList } from './LessonList'
import { firstTodo } from './setup'
import { filterGraph } from './graph'
import { GraphMap } from './GraphMap'
import { checkSources, loadState, onLearning, runAction, runLookup } from './host'
import { SettingsView } from './SettingsView'
import { SourceMenu } from './SourceMenu'
import { type GraphNode, type PageState } from './types'

type View = 'graph' | 'settings'

const emptyProfile = { username: '', email: '', team: '' }

export function App() {
  const [view, setView] = useState<View>('graph')
  const [state, setState] = useState<PageState | null>(null)
  const [hostError, setHostError] = useState('')
  const [query, setQuery] = useState('')
  const [lookupAnswer, setLookupAnswer] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [looking, setLooking] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [profile, setProfile] = useState(emptyProfile)
  const [provider, setProvider] = useState('')
  const [vaultPath, setVaultPath] = useState('')
  const [drivePath, setDrivePath] = useState('')
  const [autoDrop, setAutoDrop] = useState(false)
  const [cadence, setCadence] = useState<PageState['cadence']>('30m')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [notice, setNotice] = useState('')
  const stateRef = useRef<PageState | null>(null)

  function adopt(next: PageState) {
    stateRef.current = next
    setState(next)
    setProfile(next.profile)
    setProvider(next.provider)
    setVaultPath(next.vaultPath)
    setDrivePath(next.drivePath)
    setAutoDrop(next.autoDrop)
    setCadence(next.cadence)
    setModel(next.model)
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
  const [ranOnce, setRanOnce] = useState(false)
  const [noWebgl, setNoWebgl] = useState(false)
  useEffect(() => {
    if (state?.learning?.active) setRanOnce(true)
  }, [state?.learning?.active])
  const empty = !!state && state.graph.nodes.length === 0 && !active
  const ready = !!state && firstTodo(state) === null
  const finishedRun =
    !!state && !state.learning?.error && (ranOnce || state.learning?.active === false || state.ingest?.visible === true)
  // A finished run that found nothing gets the Home empty state, never a blank graph.
  const homeEmpty = empty && ready && finishedRun
  const firstRun = empty && !homeEmpty

  async function checkAgain() {
    apply(await checkSources())
  }

  /** Runs one action and adopts its reply; throws so callers can show the error inline. */
  async function act(body: Record<string, unknown>) {
    const next = await runAction(body)
    apply(next)
    return stateRef.current ?? next
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault()
    setLooking(true)
    setLookupError('')
    setLookupAnswer('')
    try {
      const result = await runLookup(query)
      setLookupAnswer(result.answer ?? '')
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  async function startLearning() {
    setWaiting(true)
    setNotice('')
    try {
      applyActionReply(await runAction({ action: 'start-learning' }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start learning')
      setWaiting(false)
    }
  }

  async function toggleProvider(providerId: string, on: boolean) {
    setSaving(true)
    setNotice('')
    try {
      apply(
        await runAction(on ? { action: 'activate-provider', provider: providerId } : { action: 'clear-provider' }),
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change the provider')
    } finally {
      setSaving(false)
    }
  }

  async function saveProviderKey(providerId: string, secret: string) {
    setSaving(true)
    setNotice('')
    try {
      const next = await runAction({ action: 'save-key', provider: providerId, secret })
      apply(next)
      return (next.notice ?? '') === ''
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the key')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function removeProvider(providerId: string) {
    setSaving(true)
    setNotice('')
    try {
      apply(await runAction({ action: 'revoke-key', provider: providerId }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not remove the key')
    } finally {
      setSaving(false)
    }
  }

  async function chooseModel(modelId: string) {
    setModel(modelId)
    setSaving(true)
    setNotice('')
    try {
      apply(await runAction({ action: 'select-model', model: modelId }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not choose the model')
    } finally {
      setSaving(false)
    }
  }

  async function chooseParam(id: string, value: string) {
    setSaving(true)
    setNotice('')
    try {
      apply(await runAction({ action: 'set-model-param', id, value }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not set the model option')
    } finally {
      setSaving(false)
    }
  }

  async function save() {
    if (!state) return
    setSaving(true)
    setNotice('')
    try {
      let next = state
      if (
        profile.username !== state.profile.username ||
        profile.email !== state.profile.email ||
        profile.team !== state.profile.team
      ) {
        next = await runAction({
          action: 'save-profile',
          username: profile.username,
          email: profile.email,
          team: profile.team,
        })
      }
      if (vaultPath !== state.vaultPath) next = await runAction({ action: 'set-knowledge', path: vaultPath })
      if (autoDrop !== state.autoDrop) next = await runAction({ action: 'set-auto-drop', enabled: autoDrop })
      if (drivePath !== state.drivePath) next = await runAction({ action: 'set-drive', path: drivePath })
      if (cadence !== state.cadence) next = await runAction({ action: 'set-cadence', cadence })
      apply(next)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <h1 className="shrink-0 text-[13px] font-semibold">{state?.title ?? 'Sharlie'}</h1>
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${state?.paused ? 'bg-pending' : 'bg-synced'}`}
          aria-label={state?.paused ? 'Harvest paused' : 'Harvest running'}
        />
        <form className="min-w-0 flex-1" onSubmit={(event) => void submitSearch(event)}>
          <input
            className="h-8 w-full rounded-full border border-line bg-field px-3 text-[13px] text-ink outline-none transition-colors duration-[120ms] placeholder:text-faint hover:bg-white/[0.05] focus:border-focus"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <SourceMenu sources={state?.sources ?? []} view={view} />
        <button
          type="button"
          className={`h-8 shrink-0 rounded-full border px-2.5 text-[13px] transition-colors duration-[120ms] ${view === 'settings' ? 'border-accent bg-accent text-on-accent' : 'border-line bg-field text-ink hover:bg-white/[0.05]'}`}
          aria-pressed={view === 'settings'}
          onClick={() => setView((current) => (current === 'settings' ? 'graph' : 'settings'))}
        >
          Settings
        </button>
      </header>
      {state ? (
        <LearningStrip
          learning={state.learning ?? null}
          waiting={waiting}
          lines={state.ingest?.visible ? state.ingest.lines : []}
          cardCount={cardCount}
          onSeeLessons={() => {
            setQuery('')
            setView('graph')
          }}
        />
      ) : null}
      {looking || lookupError || lookupAnswer ? (
        <p className={`border-b border-line px-3 py-2 text-[13px] ${lookupError && !looking ? 'text-pending' : 'text-muted'}`}>
          {looking ? 'Looking up' : lookupError || lookupAnswer}
        </p>
      ) : null}
      {!state && hostError ? <ServiceDown detail={hostError} retrying={retrying} onRetry={retryHost} /> : null}
      {!state && !hostError ? <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p> : null}
      {view === 'graph' && visible ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            {noWebgl ? (
              <LessonList
                nodes={visible.nodes}
                selectedId={selectedId}
                onSelect={setSelectedId}
                note="This PC can't draw the map, so here is the list."
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
            {homeEmpty ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
                <p className="text-[18px] text-ink">No lessons yet. Sharlie will learn as you work.</p>
                <button
                  type="button"
                  className="h-10 rounded-[10px] border border-accent bg-accent px-4 text-[15px] font-medium text-on-accent"
                  onClick={() => void startLearning()}
                >
                  Check again
                </button>
              </div>
            ) : null}
            {firstRun && state ? (
              <div className="absolute inset-0 overflow-auto bg-canvas">
                <FirstRun
                  state={state}
                  act={act}
                  starting={waiting}
                  startError={notice}
                  onStart={() => void startLearning()}
                  onOpenSettings={() => setView('settings')}
                  onCheckAgain={checkAgain}
                />
              </div>
            ) : null}
            {selected ? (
              <Drawer
                node={selected}
                nodes={graph?.nodes ?? []}
                links={graph?.links ?? []}
                onOpen={setSelectedId}
                onClose={() => setSelectedId('')}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {view === 'settings' && state ? (
        <SettingsView
          state={state}
          profile={profile}
          provider={provider}
          vaultPath={vaultPath}
          drivePath={drivePath}
          autoDrop={autoDrop}
          cadence={cadence}
          model={model}
          saving={saving}
          notice={notice}
          onProfile={setProfile}
          onVaultPath={setVaultPath}
          onDrivePath={setDrivePath}
          onAutoDrop={setAutoDrop}
          onCadence={setCadence}
          onToggleProvider={(providerId, on) => void toggleProvider(providerId, on)}
          onSaveKey={saveProviderKey}
          onRemoveKey={(providerId) => void removeProvider(providerId)}
          onModel={(modelId) => void chooseModel(modelId)}
          onParam={(id, value) => void chooseParam(id, value)}
          onSave={() => void save()}
        />
      ) : null}
      {view === 'graph' && state && !visible ? (
        <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p>
      ) : null}
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

