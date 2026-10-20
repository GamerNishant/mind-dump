import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'minddump:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

interface ThemeContextValue {
  theme: ThemePreference
  resolved: ResolvedTheme
  setTheme: (theme: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // Storage unavailable (private mode etc.) — fall through to default.
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    // Browser UI (mobile address bar) follows the in-app choice, not just the OS setting.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', resolved === 'dark' ? '#120f1d' : '#fdf8f3')
      m.removeAttribute('media')
    })
  }, [resolved])

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Non-fatal: preference just won't persist.
    }
  }, [])

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
