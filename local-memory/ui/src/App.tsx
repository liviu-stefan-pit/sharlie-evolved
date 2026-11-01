import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Drawer } from './Drawer'
import { filterGraph } from './graph'
import { GraphMap } from './GraphMap'
import { loadState, onLearning, runAction, runLookup } from './host'
import { SettingsView } from './SettingsView'
import { SourceMenu } from './SourceMenu'
import { formatLearningCount, formatTokenTotal, type GraphNode, type PageState } from './types'

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

  useEffect(() => {
    let cancel = false
    loadState()
      .then((next) => {
        if (!cancel) apply(next)
      })
      .catch((error: unknown) => {
        if (!cancel) setHostError(error instanceof Error ? error.message : 'Sharlie host is not available')
      })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    return onLearning((incoming) => {
      apply(incoming)
      if (incoming.learning) setWaiting(false)
    })
  }, [])

  const graph = state?.graph
  const visible = useMemo(() => (graph ? filterGraph(graph, query) : null), [graph, query])
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null
  const learningHold = holdLearning(state)

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
      {looking || lookupError || lookupAnswer ? (
        <p className={`border-b border-line px-3 py-2 text-[13px] ${lookupError && !looking ? 'text-pending' : 'text-muted'}`}>
          {looking ? 'Looking up' : lookupError || lookupAnswer}
        </p>
      ) : null}
      {!state ? (
        <p className={`px-3 py-2 text-[13px] ${hostError ? 'text-pending' : 'text-muted'}`}>
          {hostError || 'Loading the graph'}
        </p>
      ) : null}
      {view === 'graph' && visible ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col">
            <GraphMap
              graph={visible}
              selectedId={selectedId}
              onSelect={setSelectedId}
              learningActive={waiting || state?.learning?.active === true}
            />
            {state && state.graph.nodes.length === 0 && !waiting && !state.learning?.active ? (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded-full border border-accent bg-accent px-4 py-2 text-[13px] font-medium text-on-accent transition-colors duration-[120ms] focus:border-focus disabled:opacity-50"
                  disabled={learningHold !== ''}
                  onClick={() => void startLearning()}
                >
                  Start learning
                </button>
                {learningHold !== '' ? <p className="text-[13px] text-muted">{learningHold}</p> : null}
                {learningHold === '' && notice ? (
                  <p className="max-w-sm px-4 text-center text-[13px] text-pending">{notice}</p>
                ) : null}
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
          {state?.ingest?.visible ? <IngestPanel state={state} /> : null}
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
      <LearningBar
        learning={state?.learning ?? null}
        waiting={waiting}
        tokens={state?.learningTokens ?? 0}
        unreported={state?.learningTokensUnreported ?? 0}
      />
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

function IngestPanel({ state }: { state: PageState }) {
  const logRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const ingest = state.ingest
  const lines = ingest?.visible ? ingest.lines : []
  const header = state.learning
    ? formatLearningCount(state.learning.done, state.learning.total, state.learningTokens, state.learningTokensUnreported)
    : formatTokenTotal(state.learningTokens, state.learningTokensUnreported)
  const el = logRef.current
  if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24

  useLayoutEffect(() => {
    const node = logRef.current
    if (!node || lines.length === 0) return
    if (stickRef.current) node.scrollTop = node.scrollHeight
  }, [lines])

  if (!ingest?.visible) return null

  return (
    <div className="shrink-0 border-t border-line bg-panel">
      <div className="px-3 py-1.5">
        <p className="min-w-0 text-[13px] text-muted">{header}</p>
      </div>
      {state.learning?.error ? <p className="px-3 pb-1 text-[13px] text-pending">{state.learning.error}</p> : null}
      <div
        ref={logRef}
        role="log"
        aria-label="Learning log"
        className="max-h-32 overflow-auto px-3 pb-2"
        onScroll={(event) => {
          const node = event.currentTarget
          stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 24
        }}
      >
        {lines.map((line, index) => (
          <p key={`${index}:${line}`} className="py-0.5 text-[13px] text-muted">
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

function LearningBar({
  learning,
  waiting,
  tokens,
  unreported,
}: {
  learning: PageState['learning']
  waiting: boolean
  tokens: number
  unreported: number
}) {
  if (!waiting && learning?.active !== true) return null
  const total = learning?.total ?? 0
  const done = learning?.done ?? 0
  const known = total > 0
  const label = known
    ? formatLearningCount(done, total, tokens, unreported)
    : `Learning · ${formatTokenTotal(tokens, unreported)}`
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? total : undefined}
      aria-valuenow={known ? done : undefined}
      className="shrink-0 border-t border-line bg-panel"
    >
      <div className="h-1 bg-field">
        <div
          className={`h-full bg-accent ${known ? '' : 'w-1/3 animate-pulse'}`}
          style={known ? { width: `${(done / total) * 100}%` } : undefined}
        />
      </div>
      <p className="px-3 py-1.5 text-[13px] text-muted">{label}</p>
    </div>
  )
}

function holdLearning(state: PageState | null) {
  if (!state) return ''
  if (!state.hasKey) return 'Add a key in Settings.'
  const profile = state.profile
  if (profile.username.trim() === '' || profile.email.trim() === '' || profile.team.trim() === '') {
    return 'Save your username, email, and team before learning can write cards.'
  }
  if (state.provider === '') return 'Turn on a provider before learning can write cards.'
  if (state.models.length === 0) return 'This SDK has no model list. Switch to Anthropic or OpenAI to start learning.'
  if (state.model === '') return 'Choose a model before learning can write cards.'
  const chosen = state.models.find((item) => item.id === state.model)
  const required = (chosen?.parameters ?? []).filter((parameter) => parameter.values.length > 0)
  const ready = required.every((parameter) =>
    state.modelParams.some(
      (item) => item.id === parameter.id && parameter.values.some((value) => value.value === item.value),
    ),
  )
  if (!ready) return 'Choose effort and fast mode before learning can write cards.'
  return ''
}
