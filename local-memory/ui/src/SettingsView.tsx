import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { canShare, everyText, keyProviders } from './setup'
import { applyTheme, readTheme, type ThemeChoice } from './theme'
import { Details, errorText, HOST_TROUBLE } from './Trouble'
import type { CatalogParameter, PageState } from './types'

type Act = (body: Record<string, unknown>) => Promise<PageState>
type Banner = { text: string; raw?: string; action: string; run: () => void } | null

const field = 'h-10 w-full min-w-0 rounded-[10px] border border-border-input bg-field px-3 text-[15px] text-ink placeholder:text-muted disabled:opacity-60'
const quiet = 'h-9 shrink-0 rounded-[10px] border border-border-input px-3 text-[15px] text-ink hover:bg-field disabled:opacity-60'
const primary = 'h-9 shrink-0 rounded-[10px] border border-accent bg-accent px-3 text-[15px] font-medium text-on-accent disabled:opacity-60'
const pathCodes = ['path_empty', 'path_not_found', 'path_not_directory', 'path_not_writable']

function isFlag(parameter: CatalogParameter) {
  const values = parameter.values.map((item) => item.value)
  return values.length === 2 && values.includes('true') && values.includes('false')
}

function expiryLabel(value: string) {
  const parsed = new Date(value)
  if (!value || Number.isNaN(parsed.getTime())) return ''
  return `Expires ${parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
}

/** "✓ Saved" for a moment after each change; announced politely. */
function useSaved() {
  const [shown, setShown] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    shown,
    tick() {
      setShown(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setShown(false), 2500)
    },
  }
}

function Section({ title, saved, children, id }: { title: string; saved: boolean; children: ReactNode; id: string }) {
  // tabIndex -1: Home's Learn now (no key yet) moves focus to the AI key heading.
  return (
    <section aria-labelledby={id} className="rounded-[14px] border border-line bg-panel px-4 py-4">
      <div className="flex items-center gap-3">
        <h2 id={id} tabIndex={-1} className="text-[18px] font-semibold text-ink">
          {title}
        </h2>
        <span role="status" className="text-[13px] text-synced">
          {saved ? '✓ Saved' : ''}
        </span>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function Inline({ id, text }: { id: string; text: string }) {
  if (!text) return null
  return (
    <p role="alert" id={id} className="text-[13px] text-danger">
      {text}
    </p>
  )
}

export function SettingsView({ state, act, focusSection }: { state: PageState; act: Act; focusSection?: 'key' | null }) {
  const ids = useId()
  // Opened from Home's Learn now with no key: bring the AI key section into view and focus its heading.
  useEffect(() => {
    if (focusSection !== 'key') return
    const heading = document.getElementById(`${ids}-key`)
    heading?.scrollIntoView({ block: 'start' })
    heading?.focus({ preventScroll: true })
  }, [focusSection])
  const [banner, setBanner] = useState<Banner>(null)

  /** Runs one action. Field errors (a refusal with a notice) return to the caller; a thrown error goes to the banner. */
  async function run(body: Record<string, unknown>, retry: () => void): Promise<PageState | null> {
    try {
      const next = await act(body)
      setBanner((current) => (current && current.action === 'Try again' ? null : current))
      return next
    } catch (error) {
      setBanner({ text: HOST_TROUBLE, raw: errorText(error), action: 'Try again', run: retry })
      return null
    }
  }

  // --- About you
  const savedProfile = useSaved()
  const [profile, setProfile] = useState(state.profile)
  const [profileError, setProfileError] = useState('')
  useEffect(() => setProfile(state.profile), [state.profile])
  async function saveProfile() {
    const p = state.profile
    const next = { username: profile.username.trim(), email: profile.email.trim(), team: profile.team.trim() }
    if (next.username === p.username && next.email === p.email && next.team === p.team) return
    setProfileError('')
    const reply = await run({ action: 'save-profile', ...next }, () => void saveProfile())
    if (!reply) return
    if (reply.notice) setProfileError(reply.notice)
    else savedProfile.tick()
  }

  // --- AI key
  const savedKey = useSaved()
  const offered = keyProviders.filter((item) => state.providers.length === 0 || state.providers.includes(item.id))
  const [provider, setProvider] = useState<string>(offered.find((item) => item.id === state.provider)?.id ?? offered.find((item) => state.savedProviders.includes(item.id))?.id ?? offered[0]?.id ?? 'anthropic')
  const label = offered.find((item) => item.id === provider)?.label ?? provider
  const saved = state.savedProviders.includes(provider)
  const inUse = state.provider === provider
  const [secret, setSecret] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState('')
  const removeRef = useRef<HTMLButtonElement>(null)
  const [refocusRemove, setRefocusRemove] = useState(false)
  useEffect(() => {
    if (!refocusRemove || confirmRemove) return
    removeRef.current?.focus()
    setRefocusRemove(false)
  }, [refocusRemove, confirmRemove])

  async function saveKey() {
    const value = secret.trim()
    if (value === '') {
      setKeyError(`Paste your ${label} key first.`)
      return
    }
    setKeyBusy(true)
    setKeyError('')
    const reply = await run({ action: 'save-key', provider, secret: value }, () => void saveKey())
    setKeyBusy(false)
    if (!reply) return
    if (reply.errorCode === 'key_unchecked') {
      setSecret('')
      setReplacing(false)
      if (reply.provider !== provider) await useKey()
      savedKey.tick()
      if (reply.notice) setKeyError(reply.notice)
      return
    }
    if (reply.notice) {
      setKeyError(reply.errorCode === 'key_rejected' && reply.notice ? reply.notice : `That key was rejected by ${label}. Check it and try again`)
      return
    }
    setSecret('')
    setReplacing(false)
    if (reply.provider !== provider) await useKey()
    savedKey.tick()
  }
  async function useKey() {
    setKeyBusy(true)
    const reply = await run({ action: 'activate-provider', provider }, () => void useKey())
    setKeyBusy(false)
    if (reply && !reply.notice) savedKey.tick()
    if (reply?.notice) setKeyError(reply.notice)
  }
  async function removeKey() {
    setKeyBusy(true)
    const reply = await run({ action: 'revoke-key', provider }, () => void removeKey())
    setKeyBusy(false)
    setConfirmRemove(false)
    if (reply && !reply.notice) savedKey.tick()
  }

  // --- Team sharing
  const savedShare = useSaved()
  const sharing = state.share === true
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState('')
  const workQueue = state.graph.nodes.filter((node) => node.kind === 'card' && node.scope === 'work' && node.synced !== true)

  function folderBanner() {
    setBanner({ text: "Your team folder isn't reachable.", action: 'Choose folder again', run: () => void chooseShareFolder(true) })
  }
  async function chooseShareFolder(thenEnable: boolean) {
    setShareBusy(true)
    setShareError('')
    const picked = await run({ action: 'pick-folder', purpose: 'share' }, () => void chooseShareFolder(thenEnable))
    setShareBusy(false)
    if (!picked) return false
    if (!canShare(picked)) return false // host has no team sharing: never show Saved
    if (picked.errorCode && pathCodes.includes(picked.errorCode)) {
      setShareError(picked.notice ?? '')
      return false
    }
    if (picked.notice) {
      setShareError(picked.notice)
      return false
    }
    if (picked.drivePath.trim() === '') return false // cancelled the dialog
    setBanner((current) => (current?.action === 'Choose folder again' ? null : current))
    if (thenEnable && !picked.share) return setShare(true, picked.drivePath)
    savedShare.tick()
    return true
  }
  async function setShare(on: boolean, knownPath?: string): Promise<boolean> {
    if (!canShare(state)) return false
    if (on && (knownPath ?? state.drivePath).trim() === '') return chooseShareFolder(true)
    setShareBusy(true)
    setShareError('')
    const reply = await run({ action: 'set-share', enabled: on ? 'true' : 'false' }, () => void setShare(on))
    setShareBusy(false)
    if (!reply) return false
    if (!canShare(reply)) return false // host has no team sharing: never show Saved
    if (reply.errorCode && pathCodes.includes(reply.errorCode)) {
      folderBanner()
      return false
    }
    if (reply.notice) {
      setShareError(reply.notice)
      return false
    }
    savedShare.tick()
    return true
  }

  // --- Advanced
  const savedAdvanced = useSaved()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advError, setAdvError] = useState<{ at: string; text: string } | null>(null)
  const [theme, setTheme] = useState<ThemeChoice>(readTheme())
  const chosen = state.models.find((item) => item.id === state.model)
  // The host's real value; the timed option names a schedule only when the host reports one running.
  const cadence = state.cadence
  const timed = cadence === 'manual' ? '1h' : cadence
  const timedText = state.scheduled === true ? everyText(timed).replace(/^e/, 'E') : 'When I open Sharlie'
  const shareable = canShare(state)
  async function advanced(at: string, body: Record<string, unknown>) {
    setAdvError(null)
    const reply = await run(body, () => void advanced(at, body))
    if (!reply) return
    if (reply.notice) setAdvError({ at, text: reply.notice })
    // A cancelled picker, or a host without pick-folder, leaves the folder unchanged: no Saved.
    else if (at === 'folder' && reply.vaultPath === state.vaultPath) return
    else savedAdvanced.tick()
  }

  const fieldError = (id: string, show: boolean) => (show ? id : undefined)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {banner ? (
        <div role="alert" className="sticky top-0 z-30 border-b border-danger/40 bg-panel">
          <div className="mx-auto flex max-w-[640px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <p className="min-w-0 flex-1 text-[15px] text-danger">{banner.text}</p>
            <button type="button" className={quiet} onClick={banner.run}>
              {banner.action}
            </button>
            <button type="button" aria-label="Dismiss" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-muted hover:text-ink" onClick={() => setBanner(null)}>
              ×
            </button>
            {banner.raw ? <Details raw={banner.raw} className="w-full" /> : null}
          </div>
        </div>
      ) : null}
      <div className="mx-auto max-w-[640px] space-y-4 px-4 py-6">
        <h1 className="text-[22px] font-semibold text-ink">Settings</h1>

        <Section title="About you" id={`${ids}-about`} saved={savedProfile.shown}>
          <p className="text-[13px] text-muted">Each lesson is signed with these, so your team knows who learned it.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(['username', 'email', 'team'] as const).map((key) => (
              <label key={key} className="text-[13px] text-muted">
                {key === 'username' ? 'Name' : key === 'email' ? 'Email' : 'Team'}
                <input
                  className={`${field} mt-1`}
                  type={key === 'email' ? 'email' : 'text'}
                  value={profile[key]}
                  aria-describedby={fieldError(`${ids}-about-error`, profileError !== '')}
                  onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                  onBlur={() => void saveProfile()}
                />
              </label>
            ))}
          </div>
          <Inline id={`${ids}-about-error`} text={profileError} />
        </Section>

        <Section title="AI key" id={`${ids}-key`} saved={savedKey.shown}>
          <p className="text-[13px] text-muted">Sharlie uses this to write lessons. Saved securely in Windows Credential Manager, never in a settings file.</p>
          <label className="block text-[13px] text-muted sm:w-48">
            Provider
            <select
              className={`${field} mt-1`}
              value={provider}
              disabled={keyBusy}
              onChange={(e) => {
                setProvider(e.target.value)
                setKeyError('')
                setReplacing(false)
                setConfirmRemove(false)
              }}
            >
              {offered.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {saved && !replacing ? (
            <div className="space-y-2">
              <p className="text-[15px] text-ink">
                {label} key saved{inUse ? ' · in use' : ''}
                {provider === 'cursor' && expiryLabel(state.keyExpiresAt) ? <span className="text-muted"> · {expiryLabel(state.keyExpiresAt)}</span> : null}
              </p>
              {confirmRemove ? (
                <div role="group" aria-label="Confirm removing the key" className="rounded-[10px] border border-danger/50 px-3 py-3">
                  <p className="text-[15px] text-ink">Remove the {label} key from this PC? Sharlie stops learning until you add a key again.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="h-9 rounded-[10px] border border-danger px-3 text-[15px] text-danger hover:bg-field" disabled={keyBusy} onClick={() => void removeKey()}>
                      {keyBusy ? 'Removing' : 'Remove key'}
                    </button>
                    <button
                      type="button"
                      className={quiet}
                      autoFocus
                      onClick={() => {
                        setConfirmRemove(false)
                        setRefocusRemove(true)
                      }}
                    >
                      Keep key
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {!inUse ? (
                    <button type="button" className={primary} disabled={keyBusy} onClick={() => void useKey()}>
                      Use this key
                    </button>
                  ) : null}
                  <button type="button" className={quiet} onClick={() => setReplacing(true)}>
                    Replace key
                  </button>
                  <button ref={removeRef} type="button" className={quiet} onClick={() => setConfirmRemove(true)}>
                    Remove key…
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1 text-[13px] text-muted">
                {label} key
                <input
                  className={`${field} mt-1`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  aria-invalid={keyError ? true : undefined}
                  aria-describedby={fieldError(`${ids}-key-error`, keyError !== '')}
                  onChange={(e) => setSecret(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void saveKey()
                    }
                  }}
                />
              </label>
              <button type="button" className={`${primary} h-10`} disabled={keyBusy} onClick={() => void saveKey()}>
                {keyBusy ? 'Saving' : 'Save key'}
              </button>
              {replacing ? (
                <button type="button" className={`${quiet} h-10`} onClick={() => { setReplacing(false); setSecret(''); setKeyError('') }}>
                  Cancel
                </button>
              ) : null}
            </div>
          )}
          <Inline id={`${ids}-key-error`} text={keyError} />
        </Section>

        <Section title="Team sharing" id={`${ids}-share`} saved={savedShare.shown}>
          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={sharing}
              aria-labelledby={`${ids}-share-label`}
              aria-describedby={`${ids}-share-help`}
              disabled={shareBusy || !shareable}
              className="relative h-9 w-12 shrink-0 rounded-full disabled:opacity-60"
              onClick={() => void setShare(!sharing)}
            >
              <span aria-hidden="true" className={`absolute inset-x-0 top-1 h-7 rounded-full border transition-colors duration-150 ease-out ${sharing ? 'border-accent bg-accent' : 'border-border-input bg-field'}`} />
              <span aria-hidden="true" className={`absolute top-2 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 ease-out ${sharing ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <div className="min-w-0">
              <p id={`${ids}-share-label`} className="text-[15px] text-ink">
                Share work lessons with my team's Drive folder
              </p>
              <p id={`${ids}-share-help`} className="mt-1 text-[13px] text-muted">
                Only lessons from work projects are copied, after secrets such as keys and passwords are removed. Personal lessons never leave this PC.
              </p>
            </div>
          </div>
          {!shareable ? (
            <p className="text-[15px] text-muted">Team sharing isn't available in this version yet</p>
          ) : sharing ? (
            <div className="space-y-2">
              <p className="text-[15px] break-all text-ink">
                Sharing to {state.drivePath}
                {state.lastSharedAt ? <span className="text-muted"> · last shared {new Date(state.lastSharedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span> : null}
              </p>
              <button type="button" className={quiet} disabled={shareBusy} onClick={() => void chooseShareFolder(false)}>
                Change folder
              </button>
              {workQueue.length > 0 && !state.lastSharedAt ? (
                <div>
                  <p className="text-[13px] text-muted">Next to share: {workQueue.length} {workQueue.length === 1 ? 'lesson' : 'lessons'}</p>
                  <ul aria-label="Next to share" className="mt-1 list-disc pl-5 text-[13px] text-ink">
                    {workQueue.slice(0, 3).map((node) => (
                      <li key={node.id}>{node.title || node.label}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[15px] text-muted">Not sharing. Everything stays on this PC.</p>
          )}
          <Inline id={`${ids}-share-error`} text={shareError} />
        </Section>

        <section aria-labelledby={`${ids}-adv`} className="rounded-[14px] border border-line bg-panel px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 id={`${ids}-adv`} className="flex-1">
              <button type="button" className="flex min-h-9 w-full items-center gap-2 text-left text-[18px] font-semibold text-ink" aria-expanded={advancedOpen} aria-controls={`${ids}-adv-body`} onClick={() => setAdvancedOpen((v) => !v)}>
                <span aria-hidden="true" className={`text-[13px] text-muted transition-transform duration-150 ${advancedOpen ? 'rotate-90' : ''}`}>
                  ▶
                </span>
                Advanced
              </button>
            </h2>
            <span role="status" className="text-[13px] text-synced">
              {savedAdvanced.shown ? '✓ Saved' : ''}
            </span>
          </div>
          {advancedOpen ? (
            <div id={`${ids}-adv-body`} className="mt-3 space-y-4">
              <label className="block text-[13px] text-muted">
                Model
                <select className={`${field} mt-1`} value={state.model} disabled={state.models.length === 0} onChange={(e) => void advanced('model', { action: 'select-model', model: e.target.value })}>
                  {state.model === '' ? <option value="">Choose a model</option> : null}
                  {state.models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {state.models.length === 0 ? <p className="text-[13px] text-muted">This provider has no model list. Choose Anthropic or OpenAI.</p> : null}
              {(chosen?.parameters ?? []).map((parameter) => {
                const current = state.modelParams.find((item) => item.id === parameter.id)?.value ?? ''
                if (isFlag(parameter)) {
                  return (
                    <label key={parameter.id} className="flex min-h-9 items-center gap-2 text-[15px] text-ink">
                      <input type="checkbox" checked={current === 'true'} onChange={(e) => void advanced('param', { action: 'set-model-param', id: parameter.id, value: e.target.checked ? 'true' : 'false' })} />
                      {parameter.displayName ?? parameter.id}
                    </label>
                  )
                }
                return (
                  <label key={parameter.id} className="block text-[13px] text-muted">
                    {parameter.displayName ?? parameter.id}
                    <select className={`${field} mt-1`} value={current} onChange={(e) => void advanced('param', { action: 'set-model-param', id: parameter.id, value: e.target.value })}>
                      {current === '' ? <option value="">Choose</option> : null}
                      {parameter.values.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.displayName ?? item.value}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
              <Inline id={`${ids}-model-error`} text={advError && (advError.at === 'model' || advError.at === 'param') ? advError.text : ''} />
              <label className="block text-[13px] text-muted">
                When to learn
                <select
                  className={`${field} mt-1`}
                  value={cadence}
                  aria-describedby={fieldError(`${ids}-cadence-error`, advError?.at === 'cadence')}
                  onChange={(e) => void advanced('cadence', { action: 'set-cadence', cadence: e.target.value })}
                >
                  <option value={timed}>{timedText}</option>
                  <option value="manual">Only when I start it</option>
                </select>
              </label>
              <Inline id={`${ids}-cadence-error`} text={advError?.at === 'cadence' ? advError.text : ''} />
              <div>
                <p className="text-[13px] text-muted">Lessons folder</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-[15px] break-all text-ink">{state.vaultPath || 'Not chosen'}</p>
                  <button type="button" className={quiet} onClick={() => void advanced('folder', { action: 'pick-folder', purpose: 'knowledge' })}>
                    Choose folder
                  </button>
                </div>
                <Inline id={`${ids}-folder-error`} text={advError?.at === 'folder' ? advError.text : ''} />
              </div>
              <fieldset>
                <legend className="text-[13px] text-muted">Theme</legend>
                <div className="mt-1 flex flex-wrap gap-4">
                  {(['system', 'dark', 'light'] as const).map((choice) => (
                    <label key={choice} className="flex min-h-9 items-center gap-2 text-[15px] text-ink">
                      <input
                        type="radio"
                        name={`${ids}-theme`}
                        checked={theme === choice}
                        onChange={() => {
                          setTheme(choice)
                          applyTheme(choice)
                          savedAdvanced.tick()
                        }}
                      />
                      {choice === 'system' ? 'Match Windows' : choice === 'dark' ? 'Dark' : 'Light'}
                    </label>
                  ))}
                </div>
              </fieldset>
              {typeof state.chatsFound === 'number' ? (
                <p className="text-[13px] text-muted">{state.chatsFound.toLocaleString('en-US')} chats found on this PC</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
