import { useState, type ReactNode } from 'react'
import { Check, Flame, Pencil, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { SegmentButton, Segmented } from '@/components/DayPicker'
import { celebrate } from '@/components/celebrate'
import { Button, ConfirmDialog, focusRing, TextField } from '@/components/ui'
import { MAX_FIRE_TEXT, type Fire, type Verdict } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { ENERGY_LABEL, fireStats, meterLabel, VERDICT_COPY, verdictOf, type FireStats } from '@/lib/compass'
import { addDays } from '@/lib/plan'
import { usePlanner } from '@/state/PlannerProvider'

/**
 * The running Spark experiment: what you committed to, the numbers so far, today's check-in,
 * and (once the days are up, or on request) the verdict with what to do next.
 */
export function FireCard({
  fire,
  today,
  drift,
  minutesToday,
  onRelight,
}: {
  fire: Fire
  today: string
  /** Phone / random hours in the last 7 days (hour log). */
  drift: number
  /** Focus minutes on the fire today, to prefill the check-in. */
  minutesToday: number
  /** Open the commit form for a new direction (reshape or the runner-up). */
  onRelight: (title: string, runnerUp: string | null, previous: Verdict) => void
}) {
  const stats = fireStats(fire, today)
  const [reviewing, setReviewing] = useState(false)
  const todaySpark = fire.sparks.find((s) => s.day === today)

  return (
    <section aria-labelledby="fire-title" className="rounded-3xl border border-line bg-card p-5 shadow-xs sm:p-6">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-orange-700 uppercase dark:text-orange-300">
        <Flame className="size-3.5" aria-hidden />
        Your fire · day {stats.dayN} of {fire.lengthDays}
      </p>
      <h2 id="fire-title" className="mt-1 text-2xl font-semibold tracking-tight break-words text-ink">
        {fire.title}
      </h2>
      {fire.why && <p className="mt-1 text-[15px] text-ink-muted italic">“{fire.why}”</p>}
      <dl className="mt-3 grid gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-ink-subtle">Output</dt>
          <dd className="min-w-0 break-words text-ink">{fire.output}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-ink-subtle">Daily</dt>
          <dd className="min-w-0 break-words text-ink">
            {fire.minutes} min{fire.cue && <>, after I {fire.cue}</>}
          </dd>
        </div>
      </dl>

      <DayDots fire={fire} today={today} />
      <Meter stats={stats} />
      <StatGrid stats={stats} />

      {drift > 0 && (
        <p className="mt-4 rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-muted">
          <span className="font-semibold text-ink tabular-nums">{drift} h</span> went to phone / random this week. Your fire asks for{' '}
          <span className="font-semibold text-ink tabular-nums">{Math.round((fire.minutes * 7) / 6) / 10} h</span>.
          {drift * 60 >= fire.minutes * 7 && ' The time is already there.'}
        </p>
      )}

      {stats.finished || reviewing ? (
        <VerdictPanel fire={fire} stats={stats} early={!stats.finished} onClose={() => setReviewing(false)} onRelight={onRelight} />
      ) : (
        <>
          <SparkCheck key={todaySpark ? `logged-${todaySpark.energy}` : 'new'} today={today} logged={todaySpark ?? null} minutesToday={minutesToday} fireMinutes={fire.minutes} />
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setReviewing(true)}>
              Review early
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function DayDots({ fire, today }: { fire: Fire; today: string }) {
  const logged = new Set(fire.sparks.map((s) => s.day))
  const days = Array.from({ length: fire.lengthDays }, (_, i) => addDays(fire.startDay, i))
  return (
    <ol className="mt-4 flex flex-wrap gap-1.5" aria-label={`${logged.size} of ${fire.lengthDays} days checked in`}>
      {days.map((day, i) => {
        const state = logged.has(day) ? 'done' : day === today ? 'today' : day < today ? 'missed' : 'future'
        return (
          <li
            key={day}
            title={`Day ${i + 1}: ${state === 'done' ? 'checked in' : state === 'today' ? 'today' : state === 'missed' ? 'no check-in' : 'upcoming'}`}
            className={cn(
              'size-3.5 rounded-full',
              state === 'done' && 'bg-orange-600 dark:bg-orange-400',
              state === 'today' && 'border-2 border-dashed border-orange-500',
              state === 'missed' && 'border-2 border-line-strong',
              state === 'future' && 'bg-sunken',
            )}
          />
        )
      })}
    </ol>
  )
}

function Meter({ stats }: { stats: FireStats }) {
  const value = stats.meter ?? 0
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-ink">Fire meter</p>
        <p className="text-sm text-ink-muted">
          <span className="text-xl font-semibold text-ink tabular-nums">{stats.meter ?? '–'}</span>
          {stats.meter !== null && <span className="tabular-nums"> / 100</span>} · {meterLabel(stats.meter)}
        </p>
      </div>
      <div
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-label="Fire meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${stats.meter ?? 'No data'} ${meterLabel(stats.meter)}`}
      >
        <div className="h-full rounded-full bg-linear-to-r from-amber-400 via-orange-500 to-rose-600 transition-[width] duration-500" style={{ width: `${value}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-ink-subtle">Energy after sessions (70%), time flying (20%), showing up (10%).</p>
    </div>
  )
}

function StatGrid({ stats }: { stats: FireStats }) {
  const hours = Math.floor(stats.totalMinutes / 60)
  const mins = stats.totalMinutes % 60
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        label="Energy after"
        value={stats.avgEnergy === null ? '–' : `${stats.avgEnergy}/5`}
        sub={
          stats.trend === null ? (
            stats.avgEnergy === null ? 'no check-ins yet' : 'trend after 4'
          ) : (
            <span className="inline-flex items-center gap-1">
              {stats.trend >= 0 ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />}
              {stats.trend >= 0 ? 'rising' : 'falling'} {Math.abs(stats.trend)}
            </span>
          )
        }
      />
      <Stat label="Time flew" value={stats.flowRate === null ? '–' : `${Math.round(stats.flowRate * 100)}%`} sub="of sessions" />
      <Stat
        label="Showed up"
        value={stats.showRate === null ? `${stats.daysShown}` : `${Math.round(stats.showRate * 100)}%`}
        sub={`${stats.daysShown} ${stats.daysShown === 1 ? 'day' : 'days'}`}
      />
      <Stat label="Invested" value={hours ? `${hours}h ${mins}m` : `${mins}m`} sub={`${stats.sessions} ${stats.sessions === 1 ? 'session' : 'sessions'}`} />
    </dl>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <div className="rounded-xl bg-sunken px-3 py-2">
      <dt className="text-[11px] font-medium text-ink-subtle">{label}</dt>
      <dd className="text-lg leading-tight font-semibold text-ink tabular-nums">{value}</dd>
      <dd className="text-[11px] text-ink-subtle">{sub}</dd>
    </div>
  )
}

/** The check-in after a session: minutes, how alive you feel, did time fly. */
function SparkCheck({
  today,
  logged,
  minutesToday,
  fireMinutes,
}: {
  today: string
  logged: Fire['sparks'][number] | null
  minutesToday: number
  fireMinutes: number
}) {
  const planner = usePlanner()
  const [editing, setEditing] = useState(!logged)
  const [minutes, setMinutes] = useState(String(logged?.minutes ?? (minutesToday || fireMinutes)))
  const [energy, setEnergy] = useState<number | null>(logged?.energy ?? null)
  const [flow, setFlow] = useState<boolean | null>(logged?.flow ?? null)
  const [note, setNote] = useState(logged?.note ?? '')
  const [saving, setSaving] = useState(false)

  if (logged && !editing) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-600/30 bg-emerald-500/5 px-4 py-3">
        <Check className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-ink">
          Today’s spark logged: <span className="font-semibold">{ENERGY_LABEL[logged.energy - 1]}</span> · {logged.minutes} min
          {logged.flow && ' · time flew'}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Edit today’s check-in" onClick={() => setEditing(true)}>
          <Pencil aria-hidden />
        </Button>
      </div>
    )
  }

  const save = async () => {
    if (energy === null || flow === null) return
    setSaving(true)
    const ok = await planner.logSpark({ day: today, minutes: Number(minutes) || 0, energy, flow, note })
    setSaving(false)
    if (!ok) return
    setEditing(false)
    if (energy >= 4) celebrate(null)
    toast.success('Spark logged', { description: 'One more data point. Same time tomorrow.' })
  }

  return (
    <div className="mt-5 rounded-2xl border border-line p-4">
      <h3 className="text-base font-semibold tracking-tight">Today’s spark check</h3>
      <p className="text-xs text-ink-subtle">After your session. Answer for how you feel now, not how it went.</p>
      <div className="mt-3">
        <p className="mb-1.5 text-sm font-medium text-ink">How do you feel now?</p>
        <div role="group" aria-label="Energy after the session" className="grid grid-cols-5 gap-1.5">
          {ENERGY_LABEL.map((label, i) => (
            <button
              key={label}
              type="button"
              aria-pressed={energy === i + 1}
              onClick={() => setEnergy(i + 1)}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center rounded-xl border-2 text-xs font-medium transition',
                energy === i + 1 ? 'border-orange-500 bg-orange-500/10 text-ink' : 'border-line text-ink-muted hover:border-line-strong',
                focusRing,
              )}
            >
              <span className="text-base font-semibold tabular-nums">{i + 1}</span>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Did time fly?</p>
          <Segmented label="Did time fly?">
            <SegmentButton pressed={flow === true} onClick={() => setFlow(true)}>
              Yes
            </SegmentButton>
            <SegmentButton pressed={flow === false} onClick={() => setFlow(false)}>
              No
            </SegmentButton>
          </Segmented>
        </div>
        <TextField
          label="Minutes"
          className="w-24"
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </div>
      <TextField
        className="mt-3"
        label="One line (optional)"
        value={note}
        maxLength={MAX_FIRE_TEXT}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What lit you up, or what dragged"
      />
      <div className="mt-4 flex justify-end gap-2">
        {logged && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button onClick={() => void save()} loading={saving} disabled={energy === null || flow === null}>
          Log the spark
        </Button>
      </div>
    </div>
  )
}

function VerdictPanel({
  fire,
  stats,
  early,
  onClose,
  onRelight,
}: {
  fire: Fire
  stats: FireStats
  early: boolean
  onClose: () => void
  onRelight: (title: string, runnerUp: string | null, previous: Verdict) => void
}) {
  const planner = usePlanner()
  const verdict = verdictOf(stats)
  const copy = VERDICT_COPY[verdict]
  const [confirmEnd, setConfirmEnd] = useState(false)

  const extend = async (days: number, minutes?: number) => {
    if (await planner.extendFire(verdict, days, minutes)) {
      celebrate(null)
      toast.success(`New run: ${days} days`, { description: fire.title })
      onClose()
    }
  }

  return (
    <div className="animate-fade-up mt-5 rounded-2xl border-2 border-orange-500/40 bg-orange-500/5 p-4">
      <p className="text-xs font-semibold tracking-wide text-orange-700 uppercase dark:text-orange-300">
        {early ? 'Early read' : 'The verdict'}
      </p>
      <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink">{copy.title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{copy.body}</p>
      {early && <p className="mt-2 text-xs text-ink-subtle">Day {stats.dayN} of {fire.lengthDays}: early data is noisy. Finishing the run gives a real answer.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {verdict === 'keep' && <Button onClick={() => void extend(30)}>Run it for 30 days</Button>}
        {verdict === 'reshape' && (
          <>
            <Button onClick={() => onRelight(fire.title, fire.runnerUp, 'reshape')}>Change the form</Button>
            <Button variant="secondary" onClick={() => void extend(14)}>
              14 more days as is
            </Button>
          </>
        )}
        {verdict === 'switch' && (
          <>
            {fire.runnerUp && <Button onClick={() => onRelight(fire.runnerUp!, fire.title, 'switch')}>Test “{fire.runnerUp}”</Button>}
            <Button variant="secondary" onClick={() => setConfirmEnd(true)}>
              Find a new direction
            </Button>
          </>
        )}
        {verdict === 'restart' && <Button onClick={() => void extend(14, Math.min(fire.minutes, 15))}>Rerun at {Math.min(fire.minutes, 15)} min a day</Button>}
        {early ? (
          <Button variant="ghost" onClick={onClose}>
            Keep going
          </Button>
        ) : (
          verdict !== 'switch' && (
            <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
              End it here
            </Button>
          )
        )}
      </div>
      <ConfirmDialog
        open={confirmEnd}
        title="End this experiment?"
        description="It moves to “Tried before”, and its daily block leaves Today and the board. Your answers and options stay, so you can pick again."
        confirmLabel="End it"
        onConfirm={() => void planner.endFire(verdict)}
        onClose={() => setConfirmEnd(false)}
      />
    </div>
  )
}
