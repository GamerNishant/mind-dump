import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Check, ChevronRight, Flame, Plus, X } from 'lucide-react'
import { celebrate } from '@/components/celebrate'
import { Button, focusRing } from '@/components/ui'
import { MAX_HABIT_NAME, type Habit } from '@/domain/plan'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/cn'
import { currentStreak, isDone, isDue, missedLast } from '@/lib/habits'
import type { Doc } from '@/lib/plan'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'

/**
 * Today's habits, highlighted at the top of Today: one tap logs a habit as done (tap again to
 * undo). Shows each streak, and a gentle "never miss twice" nudge after a missed day.
 */
export function HabitStackCard({ view }: { view: TodayView }) {
  const { habits, habitsDue, habitsDoneToday, today } = view
  const headingId = useId()

  if (habits.length === 0) return <FirstHabit />

  const total = habitsDue.length
  const allDone = total > 0 && habitsDoneToday === total
  const resting = habits.length - total

  return (
    <section
      aria-labelledby={headingId}
      className="animate-fade-up rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.07] to-transparent p-4 sm:p-5 dark:border-emerald-400/25 dark:from-emerald-400/[0.08]"
    >
      <div className="flex items-center gap-2">
        <Flame className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
        <h2 id={headingId} className="text-[15px] font-semibold tracking-tight text-ink">
          Habits
        </h2>
        {total > 0 && (
          <span className="text-sm text-ink-muted tabular-nums" aria-live="polite">
            {habitsDoneToday} of {total} done
          </span>
        )}
        <Link to="/habits" className={cn('ml-auto inline-flex min-h-9 items-center gap-0.5 rounded-lg px-2 text-sm font-medium text-ink-muted hover:bg-sunken hover:text-ink', focusRing)}>
          Manage
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>

      {total > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-500/15" aria-hidden>
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width] duration-500 motion-reduce:transition-none dark:bg-emerald-400"
            style={{ width: `${(habitsDoneToday / total) * 100}%` }}
          />
        </div>
      )}

      {total === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No habits due today. Rest day.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {habitsDue.map((habit) => (
            <li key={habit.id}>
              <HabitButton habit={habit} today={today} />
            </li>
          ))}
        </ul>
      )}

      {(allDone || resting > 0) && (
        <p className="mt-3 text-xs text-ink-subtle">
          {allDone && <span className="font-medium text-emerald-700 dark:text-emerald-300">All done today. That's a vote for who you're becoming. </span>}
          {resting > 0 && `${resting} resting today.`}
        </p>
      )}
    </section>
  )
}

/** The big one-tap row: tap = done, tap again = undo. */
export function HabitButton({ habit, today }: { habit: Doc<Habit>; today: string }) {
  const planner = usePlanner()
  const done = isDone(habit.data, today)
  const streak = currentStreak(habit.data, today)
  const nudge = !done && missedLast(habit.data, today)

  const toggle = async (target: HTMLElement) => {
    const next = await planner.toggleHabit(habit.id, today)
    if (!next) return
    navigator.vibrate?.(12)
    const due = planner.habits().filter((h) => isDue(h.data, today))
    const allDone = due.every((h) => isDone(h.data, today))
    celebrate(allDone ? null : target, allDone ? 'big' : 'small')
  }

  return (
    <button
      type="button"
      aria-pressed={done}
      onClick={(e) => void toggle(e.currentTarget)}
      className={cn(
        'group flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100',
        focusRing,
        done
          ? 'border-emerald-600/30 bg-emerald-600/10 dark:border-emerald-400/30 dark:bg-emerald-400/10'
          : 'border-line bg-card hover:border-emerald-500/40 hover:bg-emerald-500/5',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors',
          done ? 'animate-check border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500' : 'border-line-strong text-transparent group-hover:border-emerald-500',
        )}
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[15px] font-medium', done ? 'text-ink-muted' : 'text-ink')}>{habit.data.name}</span>
        <span className={cn('block text-xs', nudge ? 'text-amber-800 dark:text-amber-300' : 'text-ink-subtle')}>
          {nudge ? 'Missed last time. Never miss twice.' : streak > 0 ? `${streak}-day streak` : done ? 'Started. Keep it going.' : 'Tap when done'}
        </span>
      </span>
      {streak > 1 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-orange-700 tabular-nums dark:text-orange-300" aria-hidden>
          <Flame className="size-4" />
          {streak}
        </span>
      )}
      <span className="sr-only">{done ? ', done today' : ', not done yet'}</span>
    </button>
  )
}

/** No habits yet: a one-line way to start the stack. */
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

function FirstHabit() {
  const planner = usePlanner()
  const [hidden, setHidden] = usePersistentState('minddump:habit-intro-hidden', false, isBool)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const inputId = useId()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const id = await planner.addHabit(name)
    setSaving(false)
    if (id) setName('')
  }

  if (hidden) return null

  return (
    <section className="rounded-3xl border border-dashed border-emerald-500/40 p-4 sm:p-5 dark:border-emerald-400/30">
      <div className="flex items-center gap-2">
        <Flame className="size-4 text-emerald-700 dark:text-emerald-300" aria-hidden />
        <h2 className="text-[15px] font-semibold tracking-tight">Start a habit</h2>
        <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setHidden(true)} aria-label="Hide this card" title="Hide (you can still add habits on the Habits page)">
          <X aria-hidden />
        </Button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">Something small you want to do every day. One tap logs it.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-3 flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Habit name
        </label>
        <input
          id={inputId}
          value={name}
          maxLength={MAX_HABIT_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Read 10 pages"
          enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
        />
        <Button type="submit" size="lg" loading={saving} disabled={!name.trim()}>
          <Plus aria-hidden />
          Add habit
        </Button>
      </form>
    </section>
  )
}
