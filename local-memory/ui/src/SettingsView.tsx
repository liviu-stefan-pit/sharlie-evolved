import { useState, type FormEvent } from 'react'
import { cadences, formatTokenTotal, providers, type CatalogParameter, type PageState } from './types'

const fieldClass =
  'mt-1 h-8 w-full rounded-[10px] border border-line bg-field px-2.5 text-[13px] text-ink outline-none transition-colors duration-[120ms] focus:border-focus'

function isFlag(parameter: CatalogParameter) {
  if (parameter.values.length !== 2) return false
  const values = parameter.values.map((item) => item.value)
  return values.includes('true') && values.includes('false')
}

function expiryLabel(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const date = parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `Expires ${date}`
}

export function SettingsView({
  state,
  profile,
  provider,
  vaultPath,
  drivePath,
  autoDrop,
  cadence,
  model,
  saving,
  notice,
  onProfile,
  onVaultPath,
  onDrivePath,
  onAutoDrop,
  onCadence,
  onToggleProvider,
  onSaveKey,
  onRemoveKey,
  onModel,
  onParam,
  onSave,
}: {
  state: PageState
  profile: PageState['profile']
  provider: string
  vaultPath: string
  drivePath: string
  autoDrop: boolean
  cadence: PageState['cadence']
  model: string
  saving: boolean
  notice: string
  onProfile: (profile: PageState['profile']) => void
  onVaultPath: (path: string) => void
  onDrivePath: (path: string) => void
  onAutoDrop: (enabled: boolean) => void
  onCadence: (cadence: PageState['cadence']) => void
  onToggleProvider: (provider: string, on: boolean) => void
  onSaveKey: (provider: string, secret: string) => Promise<boolean>
  onRemoveKey: (provider: string) => void
  onModel: (model: string) => void
  onParam: (id: string, value: string) => void
  onSave: () => void
}) {
  const [draftProvider, setDraftProvider] = useState('')
  const [draft, setDraft] = useState('')
  const offered = providers.filter((item) => state.providers.length === 0 || state.providers.includes(item.id))
  const chosen = state.models.find((item) => item.id === model)
  const expiry = provider === 'cursor' || state.savedProviders.includes('cursor') ? expiryLabel(state.keyExpiresAt) : ''

  function save(event: FormEvent) {
    event.preventDefault()
    onSave()
  }

  async function saveDraft(providerId: string) {
    const secret = draft.trim()
    if (secret === '') return
    const ok = await onSaveKey(providerId, secret)
    if (ok) {
      setDraft('')
      setDraftProvider('')
    }
  }

  return (
    <form onSubmit={save} className="min-h-0 flex-1 overflow-auto bg-canvas">
      <h2 className="px-4 pt-4 pb-1 text-[13px] font-semibold text-ink">Settings</h2>
      <section className="mx-3 mt-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <h3 className="mb-2 text-xs text-muted">Profile</h3>
        <label className="mb-2 block text-xs text-muted">
          Username
          <input
            className={fieldClass}
            value={profile.username}
            onChange={(event) => onProfile({ ...profile, username: event.target.value })}
          />
        </label>
        <label className="mb-2 block text-xs text-muted">
          Email
          <input
            className={fieldClass}
            type="email"
            value={profile.email}
            onChange={(event) => onProfile({ ...profile, email: event.target.value })}
          />
        </label>
        <label className="block text-xs text-muted">
          Team
          <input
            className={fieldClass}
            value={profile.team}
            onChange={(event) => onProfile({ ...profile, team: event.target.value })}
          />
        </label>
      </section>
      <section className="mx-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <h3 className="mb-2 text-xs text-muted">Provider</h3>
        <ul className="flex flex-col gap-3">
          {offered.map((item) => {
            const saved = state.savedProviders.includes(item.id)
            const on = provider === item.id
            const editing = draftProvider === item.id
            return (
              <li key={item.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={on}
                      disabled={!saved || saving}
                      onChange={(event) => onToggleProvider(item.id, event.target.checked)}
                    />
                    {item.label}
                  </label>
                  {item.id === 'cursor' && expiry !== '' ? <span className="text-xs text-muted">{expiry}</span> : null}
                </div>
                {saved ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-full border border-line bg-field px-2.5 text-[13px] text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
                      onClick={() => {
                        setDraftProvider(editing ? '' : item.id)
                        setDraft('')
                      }}
                    >
                      {editing ? `Cancel ${item.label} key` : `Replace ${item.label} key`}
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-full border border-line bg-field px-2.5 text-[13px] text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
                      onClick={() => onRemoveKey(item.id)}
                    >
                      {`Remove ${item.label} key`}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="h-8 self-start rounded-full border border-line bg-field px-2.5 text-[13px] text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
                    onClick={() => {
                      setDraftProvider(editing ? '' : item.id)
                      setDraft('')
                    }}
                  >
                    {editing ? `Cancel ${item.label} key` : `Add ${item.label} key`}
                  </button>
                )}
                {editing ? (
                  <div className="flex gap-2">
                    <input
                      className="h-8 min-w-0 flex-1 rounded-[10px] border border-line bg-field px-2.5 text-[13px] text-ink outline-none transition-colors duration-[120ms] focus:border-focus"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`${item.label} key`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="h-8 shrink-0 rounded-full border border-accent bg-accent px-2.5 text-[13px] font-medium text-on-accent disabled:opacity-50"
                      disabled={saving || draft.trim() === ''}
                      onClick={() => void saveDraft(item.id)}
                    >
                      {`Save ${item.label} key`}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        {provider !== '' && state.models.length > 0 ? (
          <label className="mt-3 block text-xs text-muted">
            Model
            <select
              className={fieldClass}
              aria-label="Model"
              value={model}
              disabled={saving}
              onChange={(event) => onModel(event.target.value)}
            >
              <option value="">None</option>
              {state.models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {chosen?.parameters?.map((parameter) => {
          const current = state.modelParams.find((item) => item.id === parameter.id)?.value ?? ''
          if (isFlag(parameter)) {
            return (
              <label key={parameter.id} className="mt-2 flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={current === 'true'}
                  disabled={saving}
                  onChange={(event) => onParam(parameter.id, event.target.checked ? 'true' : 'false')}
                />
                {parameter.displayName ?? 'Fast'}
              </label>
            )
          }
          return (
            <label key={parameter.id} className="mt-2 block text-xs text-muted">
              {parameter.displayName ?? parameter.id}
              <select
                className={fieldClass}
                value={current}
                disabled={saving}
                onChange={(event) => onParam(parameter.id, event.target.value)}
              >
                {parameter.values.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.displayName ?? item.value}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </section>
      <section className="mx-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <label className="block text-xs text-muted">
          Local vault
          <input
            className={fieldClass}
            spellCheck={false}
            value={vaultPath}
            onChange={(event) => onVaultPath(event.target.value)}
          />
        </label>
      </section>
      <section className="mx-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <h3 className="mb-2 text-xs text-muted">Google Drive</h3>
        <label className="mb-2 flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={autoDrop} onChange={(event) => onAutoDrop(event.target.checked)} />
          Auto-drop
        </label>
        <label className="block text-xs text-muted">
          Folder
          <input
            className={fieldClass}
            spellCheck={false}
            value={drivePath}
            onChange={(event) => onDrivePath(event.target.value)}
          />
        </label>
      </section>
      <section className="mx-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <p className="text-xs text-muted">Learning tokens</p>
        <p className="mt-1 text-[13px] text-ink">
          {formatTokenTotal(state.learningTokens, state.learningTokensUnreported)}
        </p>
      </section>
      <section className="mx-3 mb-3 rounded-xl bg-elevated px-4 py-3">
        <label className="block text-xs text-muted">
          Harvest cadence
          <select
            className={fieldClass}
            value={cadence}
            onChange={(event) => onCadence(event.target.value as PageState['cadence'])}
          >
            {cadences.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="mx-3 px-4 pb-4">
        {notice ? <p className="mb-3 text-[13px] text-pending">{notice}</p> : null}
        <button
          type="submit"
          className="rounded-full border border-accent bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent transition-colors duration-[120ms] focus:border-focus disabled:opacity-50"
          disabled={saving || !state}
        >
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
    </form>
  )
}
