import { Link } from 'react-router'
import { useUser } from '@/auth/AuthProvider'
import { greetingFor, momentumLine } from '@/lib/greeting'
import { Check, ListChecks, Moon, Quote } from 'lucide-react'
import { buttonClass } from '@/components/ui'
import { cn } from '@/lib/cn'
import { blocksDone, dateOfDay, type DotState } from '@/lib/plan'
import type { TodayView } from '@/state/PlannerProvider'

const DOT_LABEL: Record<DotState, string> = { hit: 'Floor hit', miss: 'missed', today: 'today, not yet' }

/** "Today" title, Floor counters and dots, Never-miss-twice line, Shutdown and Rules links. */
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
  // Evening, or the small hours that still belong to this planner day.
  const evening = hour >= 18 || hour < settings.dayStartHour
  const dateText = dateOfDay(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const hits = dots.filter((d) => d.state === 'hit').length

  return (
    <header>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent">
            {greetingFor(hour, settings.dayStartHour)}, {firstName}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-ink-muted">{dateText}</p>
          <p className="mt-1 text-sm text-ink">{momentumLine(doneCount, openCount)}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Link to="/rules" className={buttonClass('ghost', 'sm', 'h-10')}>
            <ListChecks aria-hidden />
            Rules
          </Link>
          {plan.shutdownAt ? (
            <Link to="/shutdown" className={buttonClass('secondary', 'sm', 'h-10 text-accent')}>
              <Check aria-hidden />
              Shutdown done
            </Link>
          ) : (
            <Link to="/shutdown" className={buttonClass(evening ? 'primary' : 'secondary', 'sm', 'h-10')}>
              <Moon aria-hidden />
              Shut down day
            </Link>
          )}
        </div>
      </div>

      <figure className="mt-4 flex gap-2.5 rounded-2xl bg-accent-soft/60 px-4 py-3 dark:bg-accent-soft/50">
        <Quote className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <blockquote className="text-[15px] leading-snug text-ink">{quote.text}</blockquote>
          <figcaption className="mt-1 text-xs text-ink-muted">— {quote.author}</figcaption>
        </div>
      </figure>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <dl className="flex items-center gap-4 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-ink-muted">Blocks</dt>
            <dd className={cn('font-semibold tabular-nums', blocks > 0 ? 'text-accent' : 'text-ink')}>
              {blocks}/{settings.blockCap}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-ink-muted">Tasks</dt>
            <dd className="font-semibold text-ink tabular-nums">
              {tasksDone}/{tasks.length}
            </dd>
          </div>
          {habitsDue.length > 0 && (
            <div className="flex items-baseline gap-1.5">
              <dt className="text-ink-muted">Habits</dt>
              <dd className={cn('font-semibold tabular-nums', habitsDoneToday === habitsDue.length ? 'text-emerald-700 dark:text-emerald-300' : 'text-ink')}>
                {habitsDoneToday}/{habitsDue.length}
              </dd>
            </div>
          )}
        </dl>

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-subtle" aria-hidden>
            Floor
          </span>
          <ol className="flex items-center gap-1.5" aria-label={`Floor, last 7 days: hit on ${hits} of 7`}>
            {dots.map((d) => {
              const weekday = dateOfDay(d.day).toLocaleDateString(undefined, { weekday: 'short' })
              const isToday = d.day === today
              return (
                <li key={d.day} title={`${weekday}: ${DOT_LABEL[d.state]}`} className="grid size-4 place-items-center">
                  <span
                    aria-hidden
                    className={cn(
                      'block rounded-full',
                      d.state === 'hit' && 'size-3 bg-accent-solid',
                      d.state === 'miss' && 'size-3 border-2 border-line-strong',
                      d.state === 'today' && 'size-3 border-2 border-accent/50',
                      isToday && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
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
