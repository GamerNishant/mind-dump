import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Flame, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ALL_DAYS, DayToggles, sameDays, SegmentButton, Segmented, WEEKDAYS } from '@/components/DayPicker'
import { SetupCard } from '@/components/today/SetupCard'
import { Button, EmptyState, focusRing, Modal, TextField } from '@/components/ui'
import { MAX_HABIT_NAME, type Habit } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { bestStreak, consistency, currentStreak, daysLabel, habitCells, type CellState } from '@/lib/habits'
import { addDays, dateOfDay, weekdayOf, type Doc } from '@/lib/plan'
import { usePlanner, useToday } from '@/state/PlannerProvider'

const pageClass = 'mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8'

/** Weeks shown in a habit's history grid. */
const HISTORY_WEEKS = 12

type Preset = 'daily' | 'weekdays' | 'custom'

const presetOf = (days: readonly number[]): Preset => (sameDays(days, ALL_DAYS) ? 'daily' : sameDays(days, WEEKDAYS) ? 'weekdays' : 'custom')

/** The habit stack: add, log (or backfill) days, see streaks and consistency, edit, reorder. */
export function HabitsPage() {
  const planner = usePlanner()
  const view = useToday()

  if (view.status === 'idle' || view.status === 'loading') {
    return (
      <main className={pageClass}>
        <div role="status" aria-label="Loading habits" className="animate-pulse space-y-3">
          <div className="h-7 w-28 rounded-lg bg-sunken" />
          <div className="h-24 rounded-2xl border border-line bg-card" />
          <div className="h-36 rounded-2xl border border-line bg-card" />
        </div>
      </main>
    )
  }
  if (view.status === 'error') {
    return (
      <main className={pageClass}>
        <EmptyState
          icon={<RefreshCw />}
          title="Couldn't load habits"
          description="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void planner.store.load()}>
              Try again
            </Button>
          }
        />
      </main>
    )
  }
  if (view.status === 'setup') {
    return (
      <main className={pageClass}>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Habits</h1>
        <SetupCard />
      </main>
    )
  }

  const { habits, today, habitsDue, habitsDoneToday } = view

  return (
    <main className={pageClass}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Habits</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Small things you do every day. They show up on Today; one tap logs them.
          {habitsDue.length > 0 && (
            <>
              {' '}
              <span className="font-medium text-ink tabular-nums">
                Today: {habitsDoneToday} of {habitsDue.length} done.
              </span>
            </>
          )}
        </p>
      </header>

      <AddHabitForm />

      {habits.length === 0 ? (
        <EmptyState icon={<Flame />} title="No habits yet" description="Add one above, e.g. “Drink 2 L water” or “Read 10 pages”. Start with one or two." />
      ) : (
        <ul className="mt-6 flex flex-col gap-3" aria-label="Your habits">
          {habits.map((habit, i) => (
            <li key={habit.id}>
              <HabitCard habit={habit} today={today} first={i === 0} last={i === habits.length - 1} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function AddHabitForm() {
  const planner = usePlanner()
  const [name, setName] = useState('')
  const [days, setDays] = useState<number[]>(ALL_DAYS)
  const [preset, setPreset] = useState<Preset>('daily')
  const [saving, setSaving] = useState(false)
  const inputId = useId()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !days.length) return
    setSaving(true)
    const id = await planner.addHabit(name, days)
    setSaving(false)
    if (!id) return
    toast.success('Habit added', { description: `${name.trim()} · ${daysLabel(days)}` })
    setName('')
  }

  const choose = (p: Preset) => {
    setPreset(p)
    if (p === 'daily') setDays(ALL_DAYS)
    if (p === 'weekdays') setDays(WEEKDAYS)
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-5 rounded-2xl border border-line bg-card p-4 shadow-xs">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        New habit
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={inputId}
          value={name}
          maxLength={MAX_HABIT_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Meditate 5 minutes"
          enterKeyHint="done"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
        />
        <Button type="submit" size="lg" loading={saving} disabled={!name.trim() || !days.length}>
          <Plus aria-hidden />
          Add habit
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented label="How often">
          <SegmentButton pressed={preset === 'daily'} onClick={() => choose('daily')}>
            Every day
          </SegmentButton>
          <SegmentButton pressed={preset === 'weekdays'} onClick={() => choose('weekdays')}>
            Weekdays
          </SegmentButton>
          <SegmentButton pressed={preset === 'custom'} onClick={() => choose('custom')}>
            Pick days
          </SegmentButton>
        </Segmented>
      </div>
      {preset === 'custom' && (
        <div className="mt-2">
          <DayToggles label="Habit days" days={days} onChange={setDays} />
          {!days.length && <p className="mt-1 text-xs text-danger">Pick at least one day.</p>}
        </div>
      )}
    </form>
  )
}

const CELL_STYLE: Record<CellState, string> = {
  done: 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500',
  missed: 'border-line-strong bg-card text-ink-muted',
  today: 'border-emerald-500 border-dashed bg-card text-ink',
  rest: 'border-transparent bg-sunken text-ink-subtle',
  before: 'border-transparent bg-sunken/60 text-ink-subtle',
  future: 'border-transparent bg-transparent text-ink-subtle',
}

const CELL_WORD: Record<CellState, string> = {
  done: 'done',
  missed: 'missed',
  today: 'not done yet',
  rest: 'rest day',
  before: 'before you started',
  future: 'upcoming',
}

function HabitCard({ habit, today, first, last }: { habit: Doc<Habit>; today: string; first: boolean; last: boolean }) {
  const planner = usePlanner()
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyId = useId()
  const { data } = habit

  const streak = currentStreak(data, today)
  const best = bestStreak(data, today)
  const rate = consistency(data, today, 30)
  const week = useMemo(() => habitCells(data, addDays(today, -6), today, today), [data, today])

  const toggleDay = async (day: string) => {
    const done = await planner.toggleHabit(habit.id, day)
    if (done) navigator.vibrate?.(12)
  }

  return (
    <article className="rounded-2xl border border-line bg-card p-4 shadow-xs">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight break-words text-ink">{data.name}</h2>
          <p className="text-xs text-ink-subtle">{daysLabel(data.days)}</p>
        </div>
        {!(first && last) && (
          <>
            <Button variant="ghost" size="icon-sm" disabled={first} onClick={() => void planner.moveHabit(habit.id, -1)} aria-label={`Move ${data.name} up`}>
              <ArrowUp aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" disabled={last} onClick={() => void planner.moveHabit(habit.id, 1)} aria-label={`Move ${data.name} down`}>
              <ArrowDown aria-hidden />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label={`Edit ${data.name}`}>
          <Pencil aria-hidden />
        </Button>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Streak" value={streak} unit={streak === 1 ? 'day' : 'days'} highlight={streak > 0} />
        <Stat label="Best" value={best} unit={best === 1 ? 'day' : 'days'} />
        <Stat label="Last 30 days" value={rate ? `${rate.percent}%` : '–'} unit={rate ? `${rate.done} of ${rate.due}` : 'no days yet'} />
      </dl>

      <div className="mt-4">
        <p className="text-xs text-ink-subtle">Last 7 days · tap a day to log or fix it</p>
        <ol className="mt-2 grid grid-cols-7 gap-1.5">
          {week.map(({ day, state }) => {
            const weekday = dateOfDay(day).toLocaleDateString(undefined, { weekday: 'short' })
            const isToday = day === today
            return (
              <li key={day}>
                <button
                  type="button"
                  aria-pressed={state === 'done'}
                  aria-label={`${isToday ? 'Today' : weekday}: ${CELL_WORD[state]}`}
                  onClick={() => void toggleDay(day)}
                  className={cn(
                    'flex h-14 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 text-xs font-medium transition active:scale-95 motion-reduce:active:scale-100',
                    CELL_STYLE[state],
                    focusRing,
                  )}
                >
                  <span aria-hidden>{isToday ? 'Today' : weekday.slice(0, 2)}</span>
                  <span aria-hidden className="grid size-4 place-items-center">
                    {state === 'done' ? <Check className="size-4 animate-check" strokeWidth={3} /> : state === 'rest' ? '·' : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <button
        type="button"
        aria-expanded={historyOpen}
        aria-controls={historyId}
        onClick={() => setHistoryOpen((o) => !o)}
        className={cn('mt-3 flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-ink-muted hover:text-ink', focusRing)}
      >
        <ChevronDown className={cn('size-4 transition-transform', historyOpen ? 'rotate-0' : '-rotate-90')} aria-hidden />
        {HISTORY_WEEKS}-week history
      </button>
      {historyOpen && <HistoryGrid id={historyId} habit={data} today={today} />}

      <EditHabitDialog habit={editing ? habit : null} onClose={() => setEditing(false)} />
    </article>
  )
}

function Stat({ label, value, unit, highlight }: { label: string; value: number | string; unit: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-sunken px-2 py-2">
      <dt className="text-[11px] font-medium text-ink-subtle">{label}</dt>
      <dd className={cn('text-lg leading-tight font-semibold tabular-nums', highlight ? 'text-orange-700 dark:text-orange-300' : 'text-ink')}>
        {highlight && <Flame className="mr-0.5 inline size-4 -translate-y-px" aria-hidden />}
        {value}
      </dd>
      <dd className="text-[11px] text-ink-subtle">{unit}</dd>
    </div>
  )
}

/** Monday-first weeks as columns, like a contribution graph. Read-only (log days above). */
function HistoryGrid({ id, habit, today }: { id: string; habit: Habit; today: string }) {
  const end = addDays(today, (7 - weekdayOf(today)) % 7) // this week's Sunday
  const start = addDays(end, -(HISTORY_WEEKS * 7 - 1)) // a Monday
  const cells = habitCells(habit, start, end, today)
  const doneCount = cells.filter((c) => c.state === 'done').length
  const weeks = Array.from({ length: HISTORY_WEEKS }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  return (
    <div id={id} className="mt-2 overflow-x-auto">
      <p className="sr-only">
        Done on {doneCount} days in the last {HISTORY_WEEKS} weeks.
      </p>
      <div className="flex gap-1" aria-hidden>
        <div className="flex flex-col gap-1 pr-1 text-[10px] leading-3 text-ink-subtle">
          {['M', '', 'W', '', 'F', '', 'S'].map((d, i) => (
            <span key={i} className="h-3">
              {d}
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map(({ day, state }) => (
              <span
                key={day}
                title={`${dateOfDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${CELL_WORD[state]}`}
                className={cn(
                  'block size-3 rounded-[3px]',
                  state === 'done' && 'bg-emerald-600 dark:bg-emerald-500',
                  state === 'missed' && 'bg-line-strong',
                  (state === 'rest' || state === 'before' || state === 'today') && 'bg-sunken',
                  state === 'today' && 'ring-1 ring-emerald-500',
                  state === 'future' && 'bg-transparent',
                )}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-3 text-[11px] text-ink-subtle" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-[2px] bg-emerald-600 dark:bg-emerald-500" /> Done
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-[2px] bg-line-strong" /> Missed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-[2px] bg-sunken ring-1 ring-line" /> Rest / not started
        </span>
      </p>
    </div>
  )
}

function EditHabitDialog({ habit, onClose }: { habit: Doc<Habit> | null; onClose: () => void }) {
  const planner = usePlanner()
  const [name, setName] = useState('')
  const [days, setDays] = useState<number[]>(ALL_DAYS)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const habitId = habit?.id

  useEffect(() => {
    if (!habit) return
    setName(habit.data.name)
    setDays(habit.data.days)
    setConfirmDelete(false)
    // Reset only when a different habit opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitId])

  if (!habit) return <Modal open={false} onClose={onClose} title="Edit habit" />

  const save = () => {
    if (!name.trim() || !days.length) return
    void planner.updateHabit(habit.id, { name, days })
    onClose()
  }

  const remove = async () => {
    const snapshot = habit
    onClose()
    if (!(await planner.removeHabit(snapshot.id))) return
    toast('Habit deleted', {
      description: snapshot.data.name,
      action: { label: 'Undo', onClick: () => void planner.restoreHabit(snapshot) },
    })
  }

  const preset = presetOf(days)

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit habit"
      footer={
        confirmDelete ? (
          <>
            <p className="mr-auto text-sm text-ink-muted">Delete it and its history?</p>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
            <Button variant="danger" autoFocus onClick={() => void remove()}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger-ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!name.trim() || !days.length}>
              Save
            </Button>
          </>
        )
      }
    >
      <TextField
        label="Name"
        value={name}
        maxLength={MAX_HABIT_NAME}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          }
        }}
      />
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-medium text-ink">Days</legend>
        <Segmented label="How often">
          <SegmentButton pressed={preset === 'daily'} onClick={() => setDays(ALL_DAYS)}>
            Every day
          </SegmentButton>
          <SegmentButton pressed={preset === 'weekdays'} onClick={() => setDays(WEEKDAYS)}>
            Weekdays
          </SegmentButton>
        </Segmented>
        <div className="mt-2">
          <DayToggles label="Habit days" days={days} onChange={setDays} />
        </div>
        {!days.length && <p className="mt-1 text-xs text-danger">Pick at least one day.</p>}
        <p className="mt-2 text-xs text-ink-subtle">Streaks skip the days it isn't due.</p>
      </fieldset>
    </Modal>
  )
}
