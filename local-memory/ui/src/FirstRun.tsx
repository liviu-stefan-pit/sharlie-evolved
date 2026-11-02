import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { firstTodo, foundSummary, keyHold, keyProviders, nothingFound, nothingToLearn, profileHold } from './setup'
import { errorText, Trouble } from './Trouble'
import type { PageState } from './types'

/** A plain sentence (refusal, missing step) or a thrown host error shown via Trouble. */
type Problem = { text: string } | { raw: string } | null

const stepOf: Record<string, 'found' | 'profile' | 'key'> = {
  no_chats: 'found',
  profile_incomplete: 'profile',
  key_missing: 'key',
  model_missing: 'key',
}

type Props = {
  state: PageState
  /** Runs one host action and adopts the reply; resolves to the new state or throws. */
  act: (body: Record<string, unknown>) => Promise<PageState>
  starting: boolean
  /** A thrown error from start-learning (raw message). */
  startError: string
  /** A refused start-learning reply: errorCode + notice. Shown at the step it is about. */
  refusal: { code: string; notice: string } | null
  onStart: () => void
  onOpenSettings: (section: 'sharing') => void
  /** Check again for chat folders (one explicit look, never a silent retry). */
  onCheckAgain: () => Promise<void>
}

const field =
  'h-10 w-full min-w-0 rounded-[10px] border border-border-input bg-field px-3 text-[15px] text-ink placeholder:text-muted'

function Step({ n, title, done, optional, problem, children, id }: { n: number; title: ReactNode; done: boolean; optional?: boolean; problem?: Problem; children: ReactNode; id: string }) {
  return (
    <li className="flex gap-3 border-t border-line py-4 first:border-t-0" aria-labelledby={id}>
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? 'bg-synced text-canvas' : 'border border-border-input text-muted'}`}
      >
        {done ? '✓' : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={id} className="text-[15px] font-semibold text-ink">
          {title}
          <span className="sr-only">{done ? ' (done)' : optional ? ' (optional)' : ' (to do)'}</span>
          {optional ? <span className="ml-2 text-[13px] font-normal text-muted">Optional</span> : null}
        </h3>
        <div className="mt-2">{children}</div>
        {problem && 'raw' in problem ? <Trouble id={`${id}-problem`} raw={problem.raw} className="mt-2" /> : null}
        {problem && 'text' in problem ? (
          <p role="alert" id={`${id}-problem`} className="mt-2 text-[13px] text-danger">
            {problem.text}
          </p>
        ) : null}
      </div>
    </li>
  )
}

export function FirstRun({ state, act, starting, startError, refusal, onStart, onOpenSettings, onCheckAgain }: Props) {
  const ids = useId()
  const [why, setWhy] = useState(false)
  const profileRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const startRef = useRef<HTMLButtonElement>(null)

  // About you: one row, saved on blur.
  const [profile, setProfile] = useState(state.profile)
  const [profileError, setProfileError] = useState<Problem>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  useEffect(() => setProfile(state.profile), [state.profile])

  async function saveProfile() {
    const p = state.profile
    if (profile.username === p.username && profile.email === p.email && profile.team === p.team) return
    setProfileError(null)
    try {
      await act({ action: 'save-profile', username: profile.username.trim(), email: profile.email.trim(), team: profile.team.trim() })
      setProfileSaved(true)
    } catch (error) {
      setProfileError({ raw: errorText(error) })
    }
  }

  // AI key: provider (Anthropic, OpenAI, Cursor) plus key; then switch it on with a default model.
  const offered = keyProviders.filter((item) => state.providers.length === 0 || state.providers.includes(item.id))
  const initialProvider = offered.find((item) => item.id === state.provider)?.id ?? offered.find((item) => state.savedProviders.includes(item.id))?.id ?? offered[0]?.id ?? 'anthropic'
  const [provider, setProvider] = useState<string>(initialProvider)
  const [secret, setSecret] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<Problem>(null)
  const [replacing, setReplacing] = useState(false)
  const saved = state.savedProviders.includes(provider)
  const providerLabel = offered.find((item) => item.id === provider)?.label ?? provider

  /** After a key is saved: switch it on, pick the first model and default options. */
  async function finishKey(next: PageState, providerId: string) {
    let s = next
    if (s.provider !== providerId) s = await act({ action: 'activate-provider', provider: providerId })
    if (s.models.length > 0 && s.model === '') s = await act({ action: 'select-model', model: s.models[0]!.id })
    const chosen = s.models.find((item) => item.id === s.model)
    for (const parameter of chosen?.parameters ?? []) {
      if (parameter.values.length === 0) continue
      if (s.modelParams.some((item) => item.id === parameter.id && parameter.values.some((v) => v.value === item.value))) continue
      const flag = parameter.values.some((v) => v.value === 'false') && parameter.values.length === 2
      s = await act({ action: 'set-model-param', id: parameter.id, value: flag ? 'false' : parameter.values[0]!.value })
    }
    return s
  }

  async function saveKey() {
    const value = secret.trim()
    if (value === '') {
      setKeyError({ text: `Paste your ${providerLabel} key first.` })
      keyRef.current?.focus()
      return
    }
    setKeyBusy(true)
    setKeyError(null)
    try {
      const next = await act({ action: 'save-key', provider, secret: value })
      if (next.errorCode === 'key_unchecked') {
        setSecret('')
        setReplacing(false)
        if (next.notice) setKeyError({ text: next.notice })
        await finishKey(next, provider)
        return
      }
      if (next.notice) {
        setKeyError({ text: next.errorCode === 'key_rejected' && next.notice ? next.notice : `That key was rejected by ${providerLabel}. Check it and try again` })
        return
      }
      setSecret('')
      setReplacing(false)
      await finishKey(next, provider)
    } catch (error) {
      setKeyError({ raw: errorText(error) })
    } finally {
      setKeyBusy(false)
    }
  }

  async function useSavedKey() {
    setKeyBusy(true)
    setKeyError(null)
    try {
      await finishKey(state, provider)
    } catch (error) {
      setKeyError({ raw: errorText(error) })
    } finally {
      setKeyBusy(false)
    }
  }

  const found = !nothingToLearn(state)
  // Chats seen earlier in this window that are now gone (folder moved, deleted, unreadable).
  const everFound = useRef(false)
  if (found) everFound.current = true
  const lost = !found && everFound.current
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<Problem>(null)
  const [checked, setChecked] = useState(false)
  const [showFolders, setShowFolders] = useState(false)
  const checkRef = useRef<HTMLButtonElement>(null)
  const foldersRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!showFolders) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowFolders(false)
      foldersRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showFolders])
  // Clicks in the same tick see the same render, so the guard is a ref, not state.
  const checkBusy = useRef(false)
  async function checkAgain() {
    if (checkBusy.current) return
    checkBusy.current = true
    setChecking(true)
    setCheckError(null)
    try {
      await onCheckAgain()
      setChecked(true)
    } catch (error) {
      setCheckError({ raw: errorText(error) })
    } finally {
      checkBusy.current = false
      setChecking(false)
    }
  }
  const folders = state.searched ?? []
  const pHold = profileHold(state)
  const kHold = keyHold(state)
  const todo = firstTodo(state)
  const refusedAt = refusal ? (stepOf[refusal.code] ?? null) : null
  const profileProblem: Problem = profileError ?? (refusedAt === 'profile' ? { text: refusal!.notice } : why && pHold ? { text: pHold } : null)
  const keyProblem: Problem = keyError ?? (refusedAt === 'key' ? { text: refusal!.notice } : why && kHold ? { text: kHold } : null)
  // A refused start points at its step: show why and move focus there.
  useEffect(() => {
    if (!refusedAt) return
    setWhy(true)
    if (refusedAt === 'found') checkRef.current?.focus()
    else if (refusedAt === 'profile') profileRef.current?.focus()
    else keyRef.current?.focus()
  }, [refusal])

  function start() {
    if (todo) {
      setWhy(true)
      if (todo === 'found') checkRef.current?.focus()
      else if (todo === 'profile') profileRef.current?.focus()
      else if (keyRef.current) keyRef.current.focus()
      else startRef.current?.focus()
      return
    }
    onStart()
  }

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="mx-auto my-6 w-[min(560px,calc(100%-24px))] rounded-[14px] border border-line bg-panel px-5 py-5 shadow-lg"
    >
      <h2 id={`${ids}-title`} className="text-[22px] leading-tight font-semibold text-ink">
        Sharlie learns from your work on this computer
      </h2>
      <p className="mt-2 text-[15px] text-muted">
        It reads the chats your coding tools already save and keeps short lessons on this PC. Removes secrets such as keys and passwords, and other people's email addresses, before anything is sent to the AI.
      </p>
      <ol className="mt-4">
        <Step
          n={1}
          id={`${ids}-found`}
          title={found ? `Found: ${foundSummary(state)}` : lost ? 'Found on this PC: no chats now' : 'Found on this PC: nothing yet'}
          done={found}
          problem={checkError ?? (refusedAt === 'found' ? { text: refusal!.notice } : null)}
        >
          {found ? (
            <p className="text-[13px] text-muted">Sharlie reads these chats on this PC.</p>
          ) : (
            <>
              <p className="text-[15px] text-muted">
                {lost
                  ? "I can't find your chats anymore. The folder may have moved or been deleted. Press Check again after it's back."
                  : 'Sharlie learns from chats saved by Cursor, Claude, or Copilot in VS Code. None were found on this PC. Use one of them for a while, then press Check again.'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  ref={checkRef}
                  type="button"
                  className="h-10 rounded-[10px] border border-accent bg-accent px-4 text-[15px] font-medium text-on-accent disabled:opacity-60"
                  disabled={checking}
                  onClick={() => void checkAgain()}
                >
                  {checking ? 'Checking' : 'Check again'}
                </button>
                {folders.length > 0 ? (
                  <button
                    ref={foldersRef}
                    type="button"
                    className="h-9 text-[15px] text-focus underline-offset-2 hover:underline"
                    aria-expanded={showFolders}
                    aria-controls={`${ids}-folders`}
                    onClick={() => setShowFolders((v) => !v)}
                  >
                    {showFolders ? 'Hide where I look' : 'Show where I look'}
                  </button>
                ) : null}
              </div>
              {checked && !checking && !checkError ? (
                <p role="status" className="mt-2 text-[13px] text-muted">
                  Still nothing found.
                </p>
              ) : null}
              {showFolders && folders.length > 0 ? (
                <ul id={`${ids}-folders`} aria-label="Folders Sharlie looks in" className="mt-2 space-y-1">
                  {folders.map((folder) => (
                    <li key={`${folder.tool}:${folder.path}`} className="text-[13px] break-all text-muted">
                      <span className="text-ink">{folder.tool}</span> · {folder.path}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Step>
        <Step n={2} id={`${ids}-profile`} title="About you" done={!pHold} problem={profileProblem}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-[13px] text-muted">
              Name
              <input
                ref={profileRef}
                aria-describedby={profileProblem ? `${ids}-profile-problem` : undefined}
                className={`${field} mt-1`}
                autoComplete="username"
                value={profile.username}
                onChange={(e) => setProfile({ ...profile, username: e.target.value })}
                onBlur={() => void saveProfile()}
              />
            </label>
            <label className="text-[13px] text-muted">
              Email
              <input
                className={`${field} mt-1`}
                type="email"
                autoComplete="email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                onBlur={() => void saveProfile()}
              />
            </label>
            <label className="text-[13px] text-muted">
              Team
              <input
                className={`${field} mt-1`}
                value={profile.team}
                onChange={(e) => setProfile({ ...profile, team: e.target.value })}
                onBlur={() => void saveProfile()}
              />
            </label>
          </div>
          {profileSaved && !profileError ? (
            <p role="status" className="mt-2 text-[13px] text-synced">
              ✓ Saved
            </p>
          ) : null}
        </Step>
        <Step n={3} id={`${ids}-key`} title="AI key" done={!kHold} problem={keyProblem}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="text-[13px] text-muted sm:w-40">
              Provider
              <select className={`${field} mt-1`} value={provider} disabled={keyBusy} onChange={(e) => { setProvider(e.target.value); setKeyError(null); setReplacing(false) }}>
                {offered.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {saved && !replacing ? (
              <div className="flex min-w-0 flex-1 flex-col justify-end gap-2 sm:flex-row sm:items-end">
                <p className="text-[15px] text-ink sm:pb-2">{providerLabel} key saved.</p>
                {state.provider !== provider || kHold ? (
                  <button type="button" className="h-10 rounded-[10px] border border-accent bg-accent px-4 text-[15px] font-medium text-on-accent disabled:opacity-60" disabled={keyBusy} onClick={() => void useSavedKey()}>
                    {keyBusy ? 'Turning on' : 'Use this key'}
                  </button>
                ) : null}
                <button type="button" className="h-10 rounded-[10px] border border-border-input px-3 text-[15px] text-ink" onClick={() => setReplacing(true)}>
                  Replace key
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-[13px] text-muted">
                  {providerLabel} key
                  <input
                    ref={keyRef}
                    className={`${field} mt-1`}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={secret}
                    aria-invalid={keyProblem ? true : undefined}
                    aria-describedby={keyProblem ? `${ids}-key-problem` : undefined}
                    onChange={(e) => setSecret(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void saveKey()
                      }
                    }}
                  />
                </label>
                <button type="button" className="h-10 shrink-0 rounded-[10px] border border-accent bg-accent px-4 text-[15px] font-medium text-on-accent disabled:opacity-60" disabled={keyBusy} onClick={() => void saveKey()}>
                  {keyBusy ? 'Saving' : 'Save key'}
                </button>
              </div>
            )}
          </div>
          <p className="mt-2 text-[13px] text-muted">Saved securely in Windows Credential Manager, never in a settings file.</p>
        </Step>
        <Step n={4} id={`${ids}-sharing`} title="Team sharing" optional done={false}>
          <p className="text-[15px] text-muted">Off. Everything stays on this PC. You can share work lessons with your team's Drive folder later.</p>
          <button type="button" className="mt-2 h-9 rounded-[10px] border border-border-input px-3 text-[15px] text-ink" onClick={() => onOpenSettings('sharing')}>
            Set up sharing
          </button>
        </Step>
      </ol>
      <div className="mt-2 border-t border-line pt-4">
        <button
          ref={startRef}
          type="button"
          className="h-11 w-full rounded-[10px] border border-accent bg-accent px-5 text-[15px] font-semibold text-on-accent disabled:opacity-60 sm:w-auto"
          disabled={starting || todo === 'found'}
          aria-describedby={todo ? `${ids}-why` : undefined}
          onClick={start}
        >
          {starting ? 'Starting' : 'Start learning'}
        </button>
        {todo ? (
          <p id={`${ids}-why`} className="mt-2 text-[13px] text-muted">
            {todo === 'found' ? nothingFound : todo === 'profile' ? 'First add your name, email, and team above.' : 'First add an AI key above.'}
          </p>
        ) : null}
        {refusal && !refusedAt ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {refusal.notice}
          </p>
        ) : null}
        {startError ? <Trouble raw={startError} className="mt-2" /> : null}
      </div>
    </section>
  )
}
