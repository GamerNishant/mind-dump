import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, RefreshCw, Sunrise, Timer } from 'lucide-react'
import { HabitStackCard } from '@/components/habits/HabitStackCard'
import { AddItemForm } from '@/components/today/AddItemForm'
import { EditItemDialog } from '@/components/today/EditItemDialog'
import { HourLogStrip } from '@/components/today/HourLogStrip'
import { MorningCheckCard } from '@/components/today/MorningCheckCard'
import { NextCard, QueueList } from '@/components/today/QueueList'
import { RestartCard } from '@/components/today/RestartCard'
import { SetupCard } from '@/components/today/SetupCard'
import { SkipSheet } from '@/components/today/SkipSheet'
import { TodayHeader } from '@/components/today/TodayHeader'
import { Button, buttonClass, EmptyState, focusRing } from '@/components/ui'
import type { FocusSession, TodayItem } from '@/domain/plan'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { focusRemainingMs, formatClock, isWindDown, type Doc } from '@/lib/plan'
import { usePlanner, useToday } from '@/state/PlannerProvider'

const pageClass = 'mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8'

export function TodayPage() {
  const planner = usePlanner()
  const view = useToday()
  const [skipping, setSkipping] = useState<Doc<TodayItem> | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (view.status === 'idle' || view.status === 'loading') {
    return (
      <main className={pageClass}>
        <TodaySkeleton />
      </main>
    )
  }

  if (view.status === 'error') {
    return (
      <main className={pageClass}>
        <EmptyState
          icon={<RefreshCw />}
          title="Couldn't load Today"
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
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Today</h1>
        <SetupCard />
      </main>
    )
  }

  const empty = view.items.length === 0

  return (
    <>
      {view.focus && <FocusBanner session={view.focus.data} />}
      <main className={pageClass}>
        <TodayHeader view={view} />

        <div className="mt-6 flex flex-col gap-6">
          <RestartCard view={view} />
          <MorningCheckCard view={view} />
          <HabitStackCard view={view} />

          {empty ? (
            <EmptyState
              icon={<Sunrise />}
              title="Nothing queued."
              description="Add from your dump (the calendar + button on a tile) or type below."
              action={
                <Link to="/" className={buttonClass('secondary')}>
                  Open the board
                  <ArrowRight aria-hidden />
                </Link>
              }
            />
          ) : (
            <>
              {view.next ? (
                <NextCard view={view} onSkip={setSkipping} onEdit={(i) => setEditingId(i.id)} />
              ) : (
                <QueueClear shutdownDone={!!view.plan.shutdownAt} windDown={isWindDown(view.now, view.settings.dayStartHour)} />
              )}
              <QueueList view={view} onSkip={setSkipping} onEdit={(i) => setEditingId(i.id)} />
            </>
          )}

          <AddItemForm view={view} />
          <HourLogStrip day={view.today} />
        </div>

        <SkipSheet item={skipping} onClose={() => setSkipping(null)} />
        <EditItemDialog
          item={view.items.find((i) => i.id === editingId && i.data.status === 'open') ?? null}
          view={view}
          onClose={() => setEditingId(null)}
        />
      </main>
    </>
  )
}

/** Sticky reminder that a block is running, with its live countdown. */
function FocusBanner({ session }: { session: FocusSession }) {
  const now = useNow(1000)
  const left = focusRemainingMs(session, now)
  const status = session.pausedAt ? 'Block paused' : left > 0 ? 'Block running' : "Block time's up"
  return (
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-accent/20 bg-accent-soft/95 backdrop-blur">
      <Link
        to="/focus"
        className={cn('mx-auto flex min-h-11 max-w-3xl items-center gap-2 px-4 text-sm font-medium text-accent sm:px-6', focusRing)}
      >
        <Timer className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {status}
          {left > 0 && (
            <>
              {' '}
              — <span className="tabular-nums">{formatClock(left)}</span> left
            </>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          Open
          <ArrowRight className="size-4" aria-hidden />
        </span>
      </Link>
    </div>
  )
}

/**
 * Everything is Done or Skipped. During the day it invites more work rather than an early
 * close; the Shutdown button only leads here at wind-down time.
 */
function QueueClear({ shutdownDone, windDown }: { shutdownDone: boolean; windDown: boolean }) {
  return (
    <section className="animate-fade-up rounded-3xl border border-line bg-card p-5 text-center sm:p-6">
      <h2 className="text-lg font-semibold tracking-tight">Queue clear</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {shutdownDone
          ? 'Day closed. Rest well.'
          : windDown
            ? 'Everything is Done or Skipped. Shut down the day when you are ready.'
            : 'Nice work. Still daytime: add the next thing below, or pull one in from the board.'}
      </p>
      {!shutdownDone && windDown && (
        <Link to="/shutdown" className={buttonClass('primary', 'md', 'mt-4')}>
          Shut down day
        </Link>
      )}
    </section>
  )
}

function TodaySkeleton() {
  return (
    <div role="status" aria-label="Loading Today" className="animate-pulse">
      <div className="h-7 w-28 rounded-lg bg-sunken" />
      <div className="mt-2 h-4 w-44 rounded bg-sunken" />
      <div className="mt-5 flex gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="size-3 rounded-full bg-sunken" />
        ))}
      </div>
      <div className="mt-6 h-48 rounded-3xl border border-line bg-card" />
      <div className="mt-6 flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 rounded-2xl border border-line bg-card" />
        ))}
      </div>
    </div>
  )
}
