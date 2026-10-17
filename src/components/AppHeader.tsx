import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { Cloud, HardDrive, History, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth, useUser } from '@/auth/AuthProvider'
import { errorMessage } from '@/data/errors'
import { initialsOf } from '@/domain/user'
import { cn } from '@/lib/cn'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'
import { buttonClass, focusRing, Logo } from './ui'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className={cn('-ml-1 rounded-lg px-1 py-0.5', focusRing)} aria-label="Mind Dump — board">
          <Logo />
        </Link>
        <nav className="ml-auto flex items-center gap-1.5" aria-label="Main">
          <NavLink
            to="/history"
            className={({ isActive }) =>
              buttonClass(isActive ? 'secondary' : 'ghost', 'sm', cn('h-9', isActive && 'text-accent'))
            }
          >
            <History aria-hidden />
            <span className="max-sm:sr-only">History</span>
          </NavLink>
          <UserMenu />
        </nav>
      </div>
    </header>
  )
}

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
]

function UserMenu() {
  const user = useUser()
  const { auth, backendKind } = useAuth()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const signOut = async () => {
    setOpen(false)
    try {
      await auth.signOut()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Account menu"
        className={cn(
          'grid size-9 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-semibold text-white shadow-sm transition hover:brightness-110',
          focusRing,
        )}
      >
        {initialsOf(user)}
      </button>

      {open && (
        <div
          id={panelId}
          className="animate-pop absolute top-full right-0 z-40 mt-2 w-72 origin-top-right rounded-2xl border border-line bg-elevated p-2 shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <div className="px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold">{user.displayName}</p>
            <p className="truncate text-sm text-ink-muted">{user.email}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-muted">
              {backendKind === 'supabase' ? (
                <>
                  <Cloud className="size-3" aria-hidden /> Synced to the cloud
                </>
              ) : (
                <>
                  <HardDrive className="size-3" aria-hidden /> Saved on this device
                </>
              )}
            </p>
          </div>

          <div className="border-t border-line px-3 py-3">
            <p id={`${panelId}-theme`} className="mb-2 text-xs font-medium text-ink-subtle">
              Theme
            </p>
            <div role="group" aria-labelledby={`${panelId}-theme`} className="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition',
                    theme === value ? 'bg-card text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-muted hover:text-ink',
                    focusRing,
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-2">
            <button
              type="button"
              onClick={() => void signOut()}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink-muted transition hover:bg-sunken hover:text-ink',
                focusRing,
              )}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
