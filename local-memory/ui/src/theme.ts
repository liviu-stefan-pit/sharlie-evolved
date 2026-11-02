export type ThemeChoice = 'system' | 'dark' | 'light'
const KEY = 'sharlie.theme'

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'dark' || value === 'light' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** Manual override under Advanced: html[data-theme], otherwise the system decides. */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Storage can be unavailable; the choice still applies for this window.
  }
}
