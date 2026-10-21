import { useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'system' | 'dark'
const STORAGE_KEY = 'tabulavibe-theme'

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage can be unavailable (private mode, blocked site data): fall back to the OS setting.
  }
  return 'system'
}

/** Theme preference: "system" follows the OS; light/dark pin it via html[data-theme]. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
    try {
      localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Ignore: the preference simply won't persist.
    }
  }, [choice])

  return [choice, setChoice]
}
