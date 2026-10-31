import { useMemo, useState } from 'react'
import { ArrowRight, Flame, RefreshCw } from 'lucide-react'
import { FindFire } from '@/components/compass/FindFire'
import { FireCard } from '@/components/compass/FireCard'
import { RightNow } from '@/components/compass/RightNow'
import { SetupCard } from '@/components/today/SetupCard'
import { Button, EmptyState, focusRing } from '@/components/ui'
import type { Verdict } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { answeredCount, compassOf, driftHours, fireMinutesOn, fireStats, meterLabel, VERDICT_COPY } from '@/lib/compass'
import { usePlanner, usePlannerState, useToday } from '@/state/PlannerProvider'

const pageClass = 'mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8'

type Mode = { name: 'home' } | { name: 'find'; start?: { title: string; runnerUp: string | null; previous: Verdict } }

/**
 * Compass: "What should I do right now?" for the next hour, and "Find your fire" (then a 14-day
 * Spark experiment) for the bigger question of what to do at all.
 */
export function CompassPage() {
  const planner = usePlanner()
  const view = useToday()
  const { docs } = usePlannerState()
  const compass = useMemo(() => compassOf(docs), [docs])
  const [mode, setMode] = useState<Mode>({ name: 'home' })

  if (view.status === 'idle' || view.status === 'loading') {
    return (
      <main className={pageClass}>
        <div role="status" aria-label="Loading Compass" className="animate-pulse space-y-3">
          <div className="h-7 w-32 rounded-lg bg-sunken" />
          <div className="h-20 rounded-3xl border border-line bg-card" />
          <div className="h-56 rounded-3xl border border-line bg-card" />
        </div>
      </main>
    )
  }
  if (view.status === 'error') {
    return (
      <main className={pageClass}>
        <EmptyState
          icon={<RefreshCw />}
          title="Couldn't load Compass"
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
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Compass</h1>
        <SetupCard />
      </main>
    )
  }

  if (mode.name === 'find') {
    return (
      <main className={pageClass}>
        <h1 className="sr-only">Find your fire</h1>
        <FindFire compass={compass} start={mode.start} onExit={() => setMode({ name: 'home' })} />
      </main>
    )
  }

  const { fire } = compass
  const loggedToday = !!fire && fireStats(fire, view.today).loggedToday

  return (
    <main className={pageClass}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Compass</h1>
        <p className="mt-1 text-sm text-ink-muted">What to do now, and what to do with it all.</p>
      </header>

      <div className="mt-6 flex flex-col gap-6">
        <RightNow compass={compass} loggedToday={loggedToday} onDiscover={() => setMode({ name: 'find' })} />

        {fire ? (
          <FireCard
            fire={fire}
            today={view.today}
            drift={driftHours(docs, view.today)}
            minutesToday={fireMinutesOn(docs, fire.dumpId, view.today, view.now)}
            onRelight={(title, runnerUp, previous) => setMode({ name: 'find', start: { title, runnerUp, previous } })}
          />
        ) : (
          <FindFireInvite answered={answeredCount(compass.answers)} options={compass.candidates.length} tried={compass.past.length} onStart={() => setMode({ name: 'find' })} />
        )}

        {compass.past.length > 0 && (
          <section aria-labelledby="past-title">
            <h2 id="past-title" className="text-sm font-semibold text-ink-muted">
              Tried before
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {compass.past.map((p, i) => (
                <li key={`${p.title}-${p.startDay}-${i}`} className="flex items-baseline gap-2 rounded-xl bg-sunken px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 break-words text-ink">{p.title}</span>
                  <span className="shrink-0 text-xs text-ink-subtle tabular-nums">
                    {p.meter} · {meterLabel(p.meter)} · {VERDICT_COPY[p.verdict].title.replace(/\.$/, '')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

function FindFireInvite({ answered, options, tried, onStart }: { answered: number; options: number; tried: number; onStart: () => void }) {
  const started = answered > 0 || options > 0
  return (
    <button
      type="button"
      onClick={onStart}
      className={cn(
        'group overflow-hidden rounded-3xl border border-orange-500/30 bg-linear-to-br from-amber-50 via-orange-50 to-rose-50 p-6 text-left shadow-xs transition hover:border-orange-500/60 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-rose-950/30',
        focusRing,
      )}
    >
      <Flame className="size-7 text-orange-600 dark:text-orange-400" aria-hidden />
      <span className="mt-3 block text-xl font-semibold tracking-tight text-ink">{tried ? 'Light the next one' : 'Find your fire'}</span>
      <span className="mt-1 block text-[15px] text-ink-muted">
        {started
          ? `You’ve answered ${answered} of 8 questions${options ? ` and named ${options} options` : ''}. Pick up where you left off.`
          : 'Feeling no pull toward anything is common, and it can be fixed. Twenty minutes to find a direction, then fourteen days to find out if it’s real.'}
      </span>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-700 dark:text-orange-300">
        {started ? 'Continue' : 'Begin'}
        <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  )
}
