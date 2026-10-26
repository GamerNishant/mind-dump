import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useUser } from '@/auth/AuthProvider'
import { greetingFor, momentumLine } from '@/lib/greeting'
import { Check, ListChecks, Moon, MoreHorizontal } from 'lucide-react'
import { buttonClass, focusRing } from '@/components/ui'
import { cn } from '@/lib/cn'
import { blocksDone, dateOfDay, isWindDown, type DotState } from '@/lib/plan'
import type { TodayView } from '@/state/PlannerProvider'

const DOT_LABEL: Record<DotState, string> = { hit: 'Floor hit', miss: 'missed', today: 'today, not yet' }

/**
 * "Today" title, one quiet line of counters and Floor dots, the daily quote, and a ⋯ menu
 * (Rules, Shut down day). Kept deliberately light: what's on screen all day shapes the mood.
 * Shut down day stays in the menu during the day, so it doesn't nudge an early close; it comes
 * forward once everything is done, and becomes the main button at wind-down time.
 */
export function TodayHeader({ view }: { view: TodayView }) {
  const { items, settings, plan, dots, now, today, quote, habitsDue, habitsDoneToday } = view
  const user = useUser()
  const firstName = user.displayName.trim().split(/\s+/)[0] || 'there'
  const doneCount = items.filter((i) => i.data.status === 'done').length + habitsDoneToday
  const openCount = items.filter((i) => i.data.status === 'open').length + (habitsDue.length - habitsDoneToday)
  const blocks = blocksDone(items)
  const tasks = items.filter((i) => i.data.type === 'task' && !i.data.habit && i.data.status !== 'skipped')
  const tasksDone = tasks.filter((i) => i.data.status === 'done').length
  const hour = now.getHours()
  const windDown = isWindDown(now, settings.dayStartHour)
  const allDone = openCount === 0 && doneCount > 0
  const showShutdown = !plan.shutdownAt && (windDown || allDone)
  const dateText = dateOfDay(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const hits = dots.filter((d) => d.state === 'hit').length

  return (
    <header>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-accent">
            {greetingFor(hour, settings.dayStartHour)}, {firstName}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-ink-muted">
            {dateText}
            <span aria-hidden> · </span>
            <span className="text-ink">{momentumLine(doneCount, openCount)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {plan.shutdownAt ? (
            <Link to="/shutdown" className={buttonClass('ghost', 'sm', 'h-10 text-accent')}>
              <Check aria-hidden />
              Shutdown done
            </Link>
          ) : (
            showShutdown && (
              <Link to="/shutdown" className={buttonClass(windDown ? 'primary' : 'secondary', 'sm', 'h-10')}>
                <Moon aria-hidden />
                Shut down day
              </Link>
            )
          )}
          <MoreMenu shutdown={!plan.shutdownAt && !showShutdown} />
        </div>
      </div>

      <figure className="mt-3 border-l-2 border-accent/30 pl-3">
        <blockquote className="text-sm leading-snug text-ink-muted italic">{quote.text}</blockquote>
        <figcaption className="mt-0.5 text-xs text-ink-subtle">— {quote.author}</figcaption>
      </figure>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <dl className="flex items-center gap-3">
          <div className="flex items-baseline gap-1">
            <dt className="text-ink-subtle">Blocks</dt>
            <dd className={cn('font-semibold tabular-nums', blocks > 0 ? 'text-accent' : 'text-ink-muted')}>
              {blocks}/{settings.blockCap}
            </dd>
          </div>
          <div className="flex items-baseline gap-1">
            <dt className="text-ink-subtle">Tasks</dt>
            <dd className="font-semibold text-ink-muted tabular-nums">
              {tasksDone}/{tasks.length}
            </dd>
          </div>
        </dl>

        <div className="flex items-center gap-1.5">
          <span className="text-ink-subtle" aria-hidden>
            Floor
          </span>
          <ol className="flex items-center gap-1" aria-label={`Floor, last 7 days: hit on ${hits} of 7`}>
            {dots.map((d) => {
              const weekday = dateOfDay(d.day).toLocaleDateString(undefined, { weekday: 'short' })
              const isToday = d.day === today
              return (
                <li key={d.day} title={`${weekday}: ${DOT_LABEL[d.state]}`} className="grid size-3.5 place-items-center">
                  <span
                    aria-hidden
                    className={cn(
                      'block size-2.5 rounded-full',
                      d.state === 'hit' && 'bg-accent-solid',
                      d.state === 'miss' && 'border-[1.5px] border-line-strong',
                      d.state === 'today' && 'border-[1.5px] border-accent/50',
                      isToday && 'ring-[1.5px] ring-accent ring-offset-1 ring-offset-canvas',
                    )}
                  />
                  <span className="sr-only">
                    {isToday ? 'Today' : weekday}: {DOT_LABEL[d.state]}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      {view.missedYesterday && (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          Never miss twice: Block 1 minimum today.
        </p>
      )}
    </header>
  )
}

const menuItem = cn('flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink hover:bg-sunken', focusRing)

/** One small ⋯ button: Rules, and Shut down day while it isn't shown in the header. */
function MoreMenu({ shutdown }: { shutdown: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="More"
        className={buttonClass('ghost', 'sm', 'size-10 px-0')}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open && (
        <div
          id={panelId}
          className="animate-pop absolute top-full right-0 z-40 mt-2 w-56 origin-top-right rounded-2xl border border-line bg-elevated p-1.5 shadow-xl shadow-black/10 dark:shadow-black/40"
        >
          <Link to="/rules" className={menuItem}>
            <ListChecks className="size-4 text-ink-muted" aria-hidden />
            Rules
          </Link>
          {shutdown && (
            <Link to="/shutdown" className={menuItem}>
              <Moon className="size-4 text-ink-muted" aria-hidden />
              Shut down day
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
