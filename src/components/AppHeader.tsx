import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { Cloud, Download, Flame, HardDrive, History, LayoutGrid, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth, useUser } from '@/auth/AuthProvider'
import { backend } from '@/data/backend'
import { errorMessage } from '@/data/errors'
import { downloadExport } from '@/data/exportData'
import { initialsOf } from '@/domain/user'
import { cn } from '@/lib/cn'
import { useToday } from '@/state/PlannerProvider'
import { useTheme, type ThemePreference } from '@/theme/ThemeProvider'
import { buttonClass, focusRing, Logo } from './ui'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className={cn('-ml-1 rounded-lg px-1 py-0.5', focusRing)} aria-label="Mind Dump — board">
          <Logo />
        </Link>
        <nav className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5" aria-label="Main">
          <NavLink to="/" end className={navClass}>
            <LayoutGrid aria-hidden />
            <span className="max-sm:sr-only">Dump</span>
          </NavLink>
          <TodayLink />
          <HabitsLink />
          <NavLink to="/history" className={navClass}>
            <History aria-hidden />
            <span className="max-sm:sr-only">History</span>
          </NavLink>
          <UserMenu />
        </nav>
      </div>
    </header>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  buttonClass(isActive ? 'secondary' : 'ghost', 'sm', cn('relative h-9 max-sm:px-2.5', isActive && 'text-accent'))

/** "Today" with a count of open items and a pulsing dot while a focus block runs. */
function TodayLink() {
  const { items, focus } = useToday()
  const open = items.filter((i) => i.data.status === 'open').length
  const running = !!focus
  const title = [open > 0 && `${open} open in Today`, running && 'Focus block running'].filter(Boolean).join(' · ')
  return (
    <NavLink to="/today" className={navClass} title={title || undefined}>
      <Sun aria-hidden />
      <span className="max-sm:sr-only">Today</span>
      {open > 0 && (
        <span
          aria-hidden
          className="grid h-4 min-w-4 place-items-center rounded-full bg-accent-solid px-1 text-[10px] leading-none font-semibold text-accent-ink tabular-nums max-sm:absolute max-sm:-top-0.5 max-sm:-right-0.5"
        >
          {open > 9 ? '9+' : open}
        </span>
      )}
      {running && (
        <span aria-hidden className="absolute top-1 left-1 flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      )}
    </NavLink>
  )
}

/** "Habits" with a ring that fills as today's habits get done. */
function HabitsLink() {
  const { habitsDue, habitsDoneToday } = useToday()
  const total = habitsDue.length
  const left = total - habitsDoneToday
  const title = total ? (left ? `${left} habit${left === 1 ? '' : 's'} left today` : 'All habits done today') : undefined
  return (
    <NavLink to="/habits" className={navClass} title={title}>
      <Flame aria-hidden />
      <span className="max-sm:sr-only">Habits</span>
      {left > 0 && (
        <span
          aria-hidden
          className="grid h-4 min-w-4 place-items-center rounded-full bg-emerald-700 px-1 text-[10px] leading-none font-semibold text-white tabular-nums max-sm:absolute max-sm:-top-0.5 max-sm:-right-0.5"
        >
          {left > 9 ? '9+' : left}
        </span>
      )}
      {left > 0 && <span className="sr-only">, {left} left</span>}
    </NavLink>
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

  const [exporting, setExporting] = useState(false)
  const exportData = async () => {
    setExporting(true)
    try {
      await downloadExport(backend, user)
      toast.success('Backup downloaded', { description: 'A JSON file with your tiles, history, habits and planner.' })
    } catch (error) {
      toast.error(`Couldn't build the backup. ${errorMessage(error)}`)
    } finally {
      setExporting(false)
    }
  }

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
              onClick={() => void exportData()}
              disabled={exporting}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-ink-muted transition hover:bg-sunken hover:text-ink disabled:opacity-60',
                focusRing,
              )}
            >
              <Download className="size-4" aria-hidden />
              {exporting ? 'Preparing backup…' : 'Download my data'}
            </button>
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
