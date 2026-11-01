import type { FormEvent } from 'react'
import { cadences, providers, type PageState } from './types'

const fieldClass =
  'mt-1 h-8 w-full rounded-[10px] border border-line bg-field px-2.5 text-[13px] text-ink outline-none transition-colors duration-[120ms] focus:border-focus'

export function SettingsView({
  state,
  profile,
  provider,
  vaultPath,
  drivePath,
  autoDrop,
  cadence,
  model,
  keyValue,
  keyShown,
  keyEditing,
  saving,
  notice,
  onProfile,
  onProvider,
  onVaultPath,
  onDrivePath,
  onAutoDrop,
  onCadence,
  onModel,
  onKeyValue,
  onToggleKey,
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
  keyValue: string
  keyShown: boolean
  keyEditing: boolean
  saving: boolean
  notice: string
  onProfile: (profile: PageState['profile']) => void
  onProvider: (provider: string) => void
  onVaultPath: (path: string) => void
  onDrivePath: (path: string) => void
  onAutoDrop: (enabled: boolean) => void
  onCadence: (cadence: PageState['cadence']) => void
  onModel: (model: string) => void
  onKeyValue: (value: string) => void
  onToggleKey: () => void
  onSave: () => void
}) {
  const offered = providers.filter((item) => state.providers.length === 0 || state.providers.includes(item.id))

  function save(event: FormEvent) {
    event.preventDefault()
    onSave()
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
        <label className="mb-2 block text-xs text-muted">
          Provider
          <select className={fieldClass} value={provider} onChange={(event) => onProvider(event.target.value)}>
            <option value="">Select a provider</option>
            {offered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Key
          <span className="mt-1 flex gap-2">
            <input
              className="h-8 min-w-0 flex-1 rounded-[10px] border border-line bg-field px-2.5 text-[13px] text-ink outline-none transition-colors duration-[120ms] focus:border-focus"
              type={keyShown ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={keyValue}
              aria-label="Key"
              onFocus={(event) => {
                if (!keyEditing) event.currentTarget.select()
              }}
              onChange={(event) => onKeyValue(event.target.value)}
            />
            <button
              type="button"
              className="h-8 shrink-0 rounded-full border border-line bg-field px-2.5 text-[13px] text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
              onClick={onToggleKey}
            >
              {keyShown ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <label className="mt-2 block text-xs text-muted">
          Model
          <select
            className={fieldClass}
            aria-label="Model"
            value={provider === state.provider ? model : ''}
            disabled={provider !== state.provider || state.models.length === 0}
            onChange={(event) => onModel(event.target.value)}
          >
            {provider !== state.provider || state.models.length === 0 ? (
              <option value="">Save to load models</option>
            ) : null}
            {provider === state.provider
              ? state.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))
              : null}
          </select>
        </label>
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
          <input
            type="checkbox"
            checked={autoDrop}
            onChange={(event) => onAutoDrop(event.target.checked)}
          />
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
