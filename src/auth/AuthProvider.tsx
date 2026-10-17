import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { backend } from '@/data/backend'
import type { AuthApi } from '@/data/types'
import type { AppUser } from '@/domain/user'

interface AuthContextValue {
  user: AppUser | null
  /** False until the initial session check has finished. */
  ready: boolean
  /** True after arriving via a password-recovery link. */
  recovery: boolean
  clearRecovery: () => void
  auth: AuthApi
  backendKind: 'supabase' | 'local'
}

const AuthContext = createContext<AuthContextValue | null>(null)

const sameUser = (a: AppUser | null, b: AppUser | null) =>
  a === b || (!!a && !!b && a.id === b.id && a.email === b.email && a.displayName === b.displayName)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    let alive = true
    // Keep the same object when nothing changed (token refreshes fire often).
    const update = (next: AppUser | null) => setUser((prev) => (sameUser(prev, next) ? prev : next))

    backend.auth
      .currentUser()
      .then((u) => alive && update(u))
      .catch(() => alive && update(null))
      .finally(() => alive && setReady(true))

    const unsubscribe = backend.auth.onChange((u, event) => {
      if (!alive) return
      update(u)
      setReady(true)
      if (event === 'recovery') setRecovery(true)
      if (event === 'signed-out') setRecovery(false)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const clearRecovery = useCallback(() => setRecovery(false), [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, recovery, clearRecovery, auth: backend.auth, backendKind: backend.kind }),
    [user, ready, recovery, clearRecovery],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** For components rendered behind RequireAuth. */
export function useUser(): AppUser {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called without a signed-in user')
  return user
}
