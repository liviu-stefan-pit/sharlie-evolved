import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Drawer } from './Drawer'
import { filterGraph } from './graph'
import { GraphMap } from './GraphMap'
import { loadState, revealKey, runAction, runLookup } from './host'
import { SettingsView } from './SettingsView'
import { SourceMenu } from './SourceMenu'
import type { PageState } from './types'

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
  const [keyDraft, setKeyDraft] = useState<string | null>(null)
  const [keyShown, setKeyShown] = useState(false)
  const [revealed, setRevealed] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState('')

  function apply(next: PageState) {
    setState(next)
    setProfile(next.profile)
    setProvider(next.provider)
    setVaultPath(next.vaultPath)
    setDrivePath(next.drivePath)
    setAutoDrop(next.autoDrop)
    setCadence(next.cadence)
    setModel(next.model)
    setKeyDraft(null)
    setKeyShown(false)
    setRevealed('')
    setNotice(next.notice ?? '')
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

  const graph = state?.graph
  const visible = useMemo(() => (graph ? filterGraph(graph, query) : null), [graph, query])
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null
  const keyValue = keyDraft !== null ? keyDraft : keyShown ? revealed : (state?.keyMask ?? '')

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
    setStarting(true)
    setNotice('')
    try {
      apply(await runAction({ action: 'start-learning' }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not start learning')
    } finally {
      setStarting(false)
    }
  }

  async function toggleKey() {
    if (keyShown) {
      setKeyShown(false)
      return
    }
    try {
      if (revealed === '' && keyDraft === null) {
        const result = await revealKey()
        setRevealed(result.secret)
      }
      setKeyShown(true)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not show the key')
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
      if (provider !== '' && provider !== state.provider) {
        next = await runAction({ action: 'activate-provider', provider })
      }
      const secret = keyDraft ?? ''
      const unchanged = keyDraft === null || secret === '' || secret === state.keyMask || secret === revealed
      if (!unchanged && (provider || state.provider)) {
        next = await runAction({
          action: 'save-key',
          provider: provider || state.provider,
          secret,
        })
      }
      if (vaultPath !== state.vaultPath) next = await runAction({ action: 'set-knowledge', path: vaultPath })
      if (autoDrop !== state.autoDrop) next = await runAction({ action: 'set-auto-drop', enabled: autoDrop })
      if (drivePath !== state.drivePath) next = await runAction({ action: 'set-drive', path: drivePath })
      if (cadence !== state.cadence) next = await runAction({ action: 'set-cadence', cadence })
      if (provider === state.provider && model !== '' && model !== state.model) {
        next = await runAction({ action: 'select-model', model })
      }
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
        <div className="relative flex min-h-0 flex-1 flex-col">
          <GraphMap graph={visible} selectedId={selectedId} onSelect={setSelectedId} />
          {state && state.graph.nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
              <button
                type="button"
                className="pointer-events-auto rounded-full border border-accent bg-accent px-4 py-2 text-[13px] font-medium text-on-accent transition-colors duration-[120ms] focus:border-focus disabled:opacity-50"
                disabled={!state.hasKey || starting}
                onClick={() => void startLearning()}
              >
                Start learning
              </button>
              {!state.hasKey ? <p className="text-[13px] text-muted">Add a key in Settings.</p> : null}
              {state.hasKey && notice ? (
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
          keyValue={keyValue}
          keyShown={keyShown}
          keyEditing={keyDraft !== null}
          saving={saving}
          notice={notice}
          onProfile={setProfile}
          onProvider={setProvider}
          onVaultPath={setVaultPath}
          onDrivePath={setDrivePath}
          onAutoDrop={setAutoDrop}
          onCadence={setCadence}
          onModel={setModel}
          onKeyValue={setKeyDraft}
          onToggleKey={() => void toggleKey()}
          onSave={() => void save()}
        />
      ) : null}
      {view === 'graph' && state && !visible ? (
        <p className="px-3 py-2 text-[13px] text-muted">Loading the graph</p>
      ) : null}
    </div>
  )
}
