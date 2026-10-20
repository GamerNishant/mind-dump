import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowLeft,
  Bookmark,
  Check,
  CheckCheck,
  Clock,
  Lightbulb,
  ListChecks,
  Moon,
  Plus,
  Repeat,
  RefreshCw,
  Search,
  SkipForward,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button, EmptyState, focusRing } from '@/components/ui'
import { SetupCard } from '@/components/today/SetupCard'
import { HabitButton } from '@/components/habits/HabitStackCard'
import { HourLogStrip } from '@/components/today/HourLogStrip'
import type { Dump } from '@/domain/dump'
import {
  CARRY_WARN,
  SHUTDOWN_MINUTES,
  SKIP_REASON_LABEL,
  SKIP_REASONS,
  type SkipReason,
  type TileMeta,
  type TodayItem,
} from '@/domain/plan'
import { cn } from '@/lib/cn'
import { blocksDone, capUsage, formatClock, hasRoomFor, resumeAction, titleFromDump, weekdayOf, type Doc } from '@/lib/plan'
import { matchesQuery } from '@/lib/sort'
import { preview } from '@/lib/text'
import { useDumpsState } from '@/state/DumpsProvider'
import { usePlanner, usePlannerState, useToday, type TodayView } from '@/state/PlannerProvider'

const PICKER_PREVIEW = 6
const FIRST_ACTION_WORDS = 10

const inputClass =
  'h-11 w-full rounded-xl border border-line bg-card px-3.5 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm'

const chipClass = (active = false) =>
  cn(
    'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors',
    focusRing,
    active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink',
  )

/** Evening Shutdown (route /shutdown): close today, set up tomorrow's Block 1, then leisure. */
export function ShutdownPage() {
  const view = useToday()

  let body: ReactNode
  if (view.status === 'setup') body = <SetupCard />
  else if (view.status === 'error')
    body = (
      <EmptyState
        icon={<RefreshCw />}
        title="Couldn't load your planner"
        description="Check your connection and reload the page."
        action={
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    )
  else if (view.status !== 'ready')
    body = (
      <div className="mt-6 space-y-3" role="status" aria-label="Loading shutdown">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-card" />
        ))}
      </div>
    )
  else body = <ShutdownScreen view={view} />

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <div className="flex items-start gap-3">
        <Link to="/today" className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-sunken hover:text-ink -ml-2', focusRing)} aria-label="Back to Today">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-semibold tracking-tight">Shutdown</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Ten minutes. Close today, set up Block 1, then enjoy your evening.</p>
        </div>
      </div>
      {body}
    </main>
  )
}

// ---- countdown -----------------------------------------------------------------------

/** Milliseconds left of a countdown that starts when the component mounts. */
function useCountdown(totalMs: number): number {
  const startRef = useRef<number | null>(null)
  const [left, setLeft] = useState(totalMs)
  useEffect(() => {
    startRef.current ??= Date.now()
    const tick = () => {
      const remaining = Math.max(0, totalMs - (Date.now() - startRef.current!))
      setLeft(remaining)
      if (remaining === 0) window.clearInterval(id)
    }
    const id = window.setInterval(tick, 500)
    tick()
    return () => window.clearInterval(id)
  }, [totalMs])
  return left
}

// ---- the screen ------------------------------------------------------------------------

function ShutdownScreen({ view }: { view: TodayView }) {
  const planner = usePlanner()
  const { docs } = usePlannerState()
  const { active } = useDumpsState()
  const navigate = useNavigate()

  // Tomorrow's routines become real items now: they count toward its caps, show in its queue
  // and can be Block 1. Idempotent (deterministic ids), so re-runs are harmless.
  useEffect(() => {
    void planner.prepareRoutines(view.tomorrow)
  }, [planner, view.tomorrow])

  const totalMs = SHUTDOWN_MINUTES * 60_000
  const left = useCountdown(totalMs)
  const timeUp = left === 0
  const [showAll, setShowAll] = useState(false)
  const collapsed = timeUp && !showAll

  const openItems = view.items.filter((i) => i.data.status === 'open')
  const resolved = view.items.length - openItems.length

  // ---- tomorrow ----
  const tomorrowItems = view.tomorrowItems.filter((i) => i.data.status !== 'skipped')
  const tomorrowUsage = capUsage(view.tomorrowItems)
  const inTomorrow = new Set(tomorrowItems.map((i) => i.data.dumpId).filter((id): id is string => !!id))
  const tomorrowWeekday = weekdayOf(view.tomorrow)
  // Any item (even a skipped one) means the routine was already created for tomorrow.
  const anyTomorrow = new Set(view.tomorrowItems.map((i) => i.data.dumpId).filter((id): id is string => !!id))
  const routines = active.filter((d) => !anyTomorrow.has(d.id) && view.metas.get(d.id)?.repeat?.includes(tomorrowWeekday))
  const block1 = tomorrowItems.find((i) => i.data.type === 'block') ?? null

  // ---- Block 1 draft (reset whenever tomorrow's Block 1 changes) ----
  const prefill = (b: Doc<TodayItem> | null) => ({
    id: b?.id ?? null,
    firstAction: b ? b.data.firstAction || resumeAction(metaOf(view.metas, b.data.dumpId)?.resumeNote ?? '') : '',
    minimum: b?.data.minimum ?? '',
  })
  const [draft, setDraft] = useState(() => prefill(block1))
  if ((block1?.id ?? null) !== draft.id) setDraft(prefill(block1))

  const draftPatch = () => {
    if (!block1) return null
    const patch: Partial<Pick<TodayItem, 'firstAction' | 'minimum'>> = {}
    if (draft.firstAction.trim() !== block1.data.firstAction) patch.firstAction = draft.firstAction.trim()
    if (draft.minimum.trim() !== block1.data.minimum) patch.minimum = draft.minimum.trim()
    return Object.keys(patch).length ? patch : null
  }
  const saveDraft = () => {
    const patch = draftPatch()
    if (block1 && patch) void planner.updateItem(block1.id, patch)
  }

  // ---- checks + close ----
  const [foodSorted, setFoodSorted] = useState(view.plan.foodSorted)
  const [hourLogOpen, setHourLogOpen] = useState(false)
  const [closing, setClosing] = useState(false)

  const done = blocksDone(view.items)
  const plannedBlocks = view.items.filter((i) => i.data.type === 'block').length
  const tomorrowFirst =
    draft.firstAction.trim() || block1?.data.title || tomorrowItems[0]?.data.title || (routines[0] ? titleFromDump(routines[0].content) : '')

  const [ruleSeed] = useState(() => Math.random())
  const rule = useMemo(() => {
    const rules = planner.rules().filter((r) => r.data.active)
    return rules.length ? rules[Math.floor(ruleSeed * rules.length)].data : null
    // `docs` makes this re-read the rules when the store changes.
  }, [planner, docs, ruleSeed])

  const complete = async () => {
    setClosing(true)
    const patch = draftPatch()
    if (block1 && patch) await planner.updateItem(block1.id, patch)
    const ok = await planner.shutdown(view.today, { tomorrowFirst, foodSorted })
    setClosing(false)
    if (!ok) return
    toast.success('Shutdown complete. Enjoy your evening — set the end time before you press play.')
    navigate('/today')
  }

  const shutdownAt = view.plan.shutdownAt
    ? new Date(view.plan.shutdownAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="mt-5 space-y-4">
      <CountdownBar left={left} total={totalMs} />

      {shutdownAt && (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm text-ink-muted">
          <CheckCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>Already shut down at {shutdownAt} — you can update it.</span>
        </p>
      )}

      <div role="status" aria-live="polite">
        {timeUp && (
          <div className="animate-fade-up flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/40 bg-accent-soft px-3.5 py-3 text-sm text-ink">
            <Clock className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 font-medium">Time's up — keep only Block 1 and close.</span>
            <button type="button" onClick={() => setShowAll((v) => !v)} className={cn('rounded-md text-sm font-medium text-accent underline-offset-2 hover:underline', focusRing)}>
              {showAll ? 'Show only Block 1' : 'Show everything'}
            </button>
          </div>
        )}
      </div>

      {/* 1. Resolve today */}
      <Section n={1} title="Resolve today" aside={view.items.length > 0 ? `${resolved}/${view.items.length} resolved` : undefined}>
        {openItems.length === 0 ? (
          <p className="text-sm font-medium text-accent">
            {view.items.length ? 'All resolved ✓' : 'Nothing was planned today. All resolved ✓'}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted">Each item ends Done or Skipped with a reason. Nothing leaves silently.</p>
            <ul className="space-y-2">
              {openItems.map((item) => (
                <ResolveRow key={item.id} item={item} />
              ))}
            </ul>
          </>
        )}
      </Section>

      {/* 2. Tomorrow's queue */}
      {!collapsed && (
        <Section
          n={2}
          title="Tomorrow's queue"
          aside={`Blocks ${tomorrowUsage.blocks}/${view.settings.blockCap} · Tasks ${tomorrowUsage.tasks}/${view.settings.taskCap}`}
        >
          <TomorrowQueue view={view} items={tomorrowItems} routines={routines} />
          <TomorrowPicker view={view} dumps={active} exclude={inTomorrow} routineIds={new Set(routines.map((d) => d.id))} />
        </Section>
      )}

      {/* 3. Tomorrow's Block 1 */}
      <Section n={3} title="Tomorrow's Block 1">
        {block1 ? (
          <Block1Fields
            block={block1}
            meta={metaOf(view.metas, block1.data.dumpId)}
            firstAction={draft.firstAction}
            minimum={draft.minimum}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onSave={saveDraft}
          />
        ) : (
          <NoBlockHint view={view} items={tomorrowItems} collapsed={collapsed} onShowAll={() => setShowAll(true)} />
        )}
      </Section>

      {/* 4. Checks */}
      {!collapsed && (
        <Section n={4} title="Checks">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={foodSorted}
              onChange={(e) => setFoodSorted(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-[var(--color-accent-solid)]"
            />
            <span>Breakfast and lunch for tomorrow are sorted</span>
          </label>
          {view.habitsDue.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-ink">
                Habits today <span className="font-normal text-ink-muted tabular-nums">({view.habitsDoneToday} of {view.habitsDue.length})</span>
              </p>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {view.habitsDue.map((habit) => (
                  <li key={habit.id}>
                    <HabitButton habit={habit} today={view.today} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <button
              type="button"
              aria-expanded={hourLogOpen}
              onClick={() => setHourLogOpen((v) => !v)}
              className={cn('inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-accent underline-offset-2 hover:underline', focusRing)}
            >
              <ListChecks className="size-4" aria-hidden />
              {hourLogOpen ? 'Hide hour log' : 'Fill hour-log gaps'}
            </button>
            {hourLogOpen && (
              <div className="mt-3">
                <HourLogStrip day={view.today} defaultOpen />
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 5. Close */}
      <Section n={5} title="Close">
        <dl className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-sunken px-3.5 py-3">
            <dt className="text-xs font-medium text-ink-subtle">Blocks done</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {done}/{Math.max(plannedBlocks, done) || view.settings.blockCap}
            </dd>
          </div>
          <div className="rounded-xl bg-sunken px-3.5 py-3">
            <dt className="text-xs font-medium text-ink-subtle">Floor</dt>
            <dd className={cn('mt-0.5 text-lg font-semibold', done > 0 ? 'text-accent' : 'text-ink')}>{done > 0 ? 'Yes' : 'Not today'}</dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-ink-muted">
          {done > 0
            ? 'A block’s minimum is in. This shutdown completes the Floor.'
            : view.missedYesterday
              ? 'Still time? One 25-minute rescue block counts. Otherwise: tomorrow, Block 1’s minimum is the whole job.'
              : 'Still time? One 25-minute rescue block counts. If not, that’s data. Never miss twice.'}
        </p>

        {rule && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-line px-3.5 py-3 text-sm text-ink-muted">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="font-medium text-ink">If</span> {rule.ifText}, <span className="font-medium text-ink">then</span> {rule.thenText}{' '}
              <Link to="/rules" className={cn('rounded text-accent underline-offset-2 hover:underline', focusRing)}>
                Rules
              </Link>
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={() => void complete()}
          disabled={openItems.length > 0 || closing}
          aria-describedby={openItems.length > 0 ? 'shutdown-blocked' : undefined}
          className={cn(
            'mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-solid px-5 py-3 text-center text-[15px] font-semibold text-accent-ink shadow-sm shadow-accent/25 transition-[background-color,opacity] hover:bg-accent-solid-hover disabled:pointer-events-none disabled:opacity-50',
            focusRing,
          )}
        >
          <Moon className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">
            {tomorrowFirst ? `Shutdown complete. Tomorrow starts with: ${tomorrowFirst}` : 'Shutdown complete.'}
          </span>
        </button>
        {openItems.length > 0 && (
          <p id="shutdown-blocked" className="mt-2 text-center text-sm text-ink-muted">
            Resolve {openItems.length === 1 ? 'the 1 open item' : `the ${openItems.length} open items`} above first: Done or Skip.
          </p>
        )}
      </Section>
    </div>
  )
}

const metaOf = (metas: ReadonlyMap<string, TileMeta>, dumpId: string | null) => (dumpId ? metas.get(dumpId) : undefined)

// ---- pieces -------------------------------------------------------------------------------

function CountdownBar({ left, total }: { left: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (left / total) * 100))
  const low = left > 0 && left <= 60_000
  return (
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)] z-20 rounded-xl border border-line bg-elevated/90 px-3.5 py-2.5 shadow-sm backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <Clock className={cn('size-4 shrink-0', left === 0 || low ? 'text-danger' : 'text-accent')} aria-hidden />
        <span className="text-ink-muted">Shutdown</span>
        <span className={cn('ml-auto font-semibold tabular-nums', left === 0 || low ? 'text-danger' : 'text-ink')} aria-label={`Time left ${formatClock(left)}`}>
          {formatClock(left)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className={cn('h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500', low || left === 0 ? 'bg-danger' : 'bg-accent-solid')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-card p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>
          {n}
        </span>
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {aside && <span className="ml-auto text-xs font-medium text-ink-subtle tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function TypeBadge({ type }: { type: TodayItem['type'] }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold uppercase tracking-wide',
        type === 'block' ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted',
      )}
    >
      {type === 'block' ? 'Block' : 'Task'}
    </span>
  )
}

// ---- 1. resolve ---------------------------------------------------------------------------

function ResolveRow({ item }: { item: Doc<TodayItem> }) {
  const planner = usePlanner()
  const [skipping, setSkipping] = useState(false)
  const [asking, setAsking] = useState(false)
  const [notMet, setNotMet] = useState(false)
  const [reason, setReason] = useState<SkipReason | null>(null)
  const [busy, setBusy] = useState(false)
  const reasonGroup = useId()
  const minGroup = useId()
  const title = preview(item.data.title, 80)

  const isBlock = item.data.type === 'block'

  const markDone = async () => {
    setAsking(false)
    setBusy(true)
    const ok = await planner.complete(item.id, true)
    setBusy(false)
    if (ok) toast.success('Done', { description: title, action: { label: 'Undo', onClick: () => void planner.reopen(item.id) } })
  }

  // A Block is Done only when its minimum is in (the Floor counts it). Not met → skip it with a reason.
  const onDone = () => {
    if (!isBlock) return void markDone()
    setSkipping(false)
    setAsking((v) => !v)
  }
  const answerNo = () => {
    setAsking(false)
    setNotMet(true)
    setSkipping(true)
  }

  const skip = async (to: 'tomorrow' | 'dump') => {
    if (!reason) return
    setBusy(true)
    const ok = await planner.skip(item.id, reason, to)
    setBusy(false)
    if (!ok) return
    if (to === 'tomorrow') toast.success('Moved to tomorrow', { description: title })
    else toast.success('Back to the dump', { description: 'The tile stays on your board.', action: { label: 'Undo', onClick: () => void planner.reopen(item.id) } })
  }

  return (
    <li className="rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={item.data.type} />
            {item.data.carryCount > 0 && (
              <span className={cn('text-xs font-medium', item.data.carryCount >= CARRY_WARN ? 'text-danger' : 'text-ink-subtle')}>
                Carried ×{item.data.carryCount}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium break-words text-ink">{item.data.title}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="secondary" className="pointer-coarse:h-10" onClick={onDone} aria-expanded={isBlock ? asking : undefined} disabled={busy}>
            <Check aria-hidden />
            Done
          </Button>
          <Button
            size="sm"
            variant={skipping ? 'secondary' : 'ghost'}
            className="pointer-coarse:h-10"
            aria-expanded={skipping}
            onClick={() => {
              setAsking(false)
              setNotMet(false)
              setSkipping((v) => !v)
            }}
            disabled={busy}
          >
            <SkipForward aria-hidden />
            Skip
          </Button>
        </div>
      </div>
      {asking && (
        <div role="group" aria-labelledby={minGroup} className="animate-fade-up mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-sunken px-3 py-2">
          <span id={minGroup} className="text-sm font-medium text-ink">
            Minimum met?
          </span>
          <Button size="sm" className="pointer-coarse:h-10" onClick={() => void markDone()} disabled={busy}>
            Yes
          </Button>
          <Button size="sm" variant="secondary" className="pointer-coarse:h-10" onClick={answerNo} disabled={busy}>
            No
          </Button>
        </div>
      )}
      {skipping && (
        <div className="animate-fade-up mt-3 border-t border-line pt-3">
          {notMet && <p className="mb-2 text-sm text-ink-muted">Not met? Skip it with a reason, or move it to tomorrow.</p>}
          <p id={reasonGroup} className="mb-2 text-xs font-medium text-ink-subtle">
            Why?
          </p>
          <div role="group" aria-labelledby={reasonGroup} className="flex flex-wrap gap-1.5">
            {SKIP_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={cn(chipClass(reason === r), 'pointer-coarse:h-10')}>
                {SKIP_REASON_LABEL[r]}
              </button>
            ))}
          </div>
          {item.data.carryCount >= CARRY_WARN && reason === 'too_big' && <p className="mt-2 text-xs text-ink-muted">Too big? Split it into a smaller tile on the board.</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" className="pointer-coarse:h-10" disabled={!reason || busy} onClick={() => void skip('tomorrow')}>
              To tomorrow
            </Button>
            <Button size="sm" variant="secondary" className="pointer-coarse:h-10" disabled={!reason || busy} onClick={() => void skip('dump')}>
              Back to dump
            </Button>
            {!reason && <span className="self-center text-xs text-ink-subtle">Pick a reason first</span>}
          </div>
        </div>
      )}
    </li>
  )
}

// ---- 2. tomorrow ----------------------------------------------------------------------------

function TomorrowQueue({ view, items, routines }: { view: TodayView; items: Array<Doc<TodayItem>>; routines: Dump[] }) {
  const planner = usePlanner()

  if (!items.length && !routines.length) return <p className="text-sm text-ink-muted">Nothing queued yet. Pick Block 1 from your board below.</p>

  const toggleType = async (item: Doc<TodayItem>) => {
    const next = item.data.type === 'block' ? 'task' : 'block'
    const others = view.tomorrowItems.filter((i) => i.id !== item.id)
    if (!item.data.habit && !hasRoomFor(next, others, view.settings)) {
      toast.error(next === 'block' ? `Tomorrow already has ${view.settings.blockCap} Blocks` : `Tomorrow already has ${view.settings.taskCap} Tasks`)
      return
    }
    await planner.updateItem(item.id, { type: next })
  }

  // Fresh adds can be removed outright; items that were skipped or carried keep their history.
  const remove = async (item: Doc<TodayItem>) => {
    if (!item.data.skips.length && item.data.carryCount === 0) {
      if (await planner.removeItem(item.id)) toast.success('Removed from tomorrow', { description: preview(item.data.title) })
    } else if (await planner.skip(item.id, 'not_today', 'dump')) {
      toast.success('Back to the dump', { description: 'The tile stays on your board.', action: { label: 'Undo', onClick: () => void planner.reopen(item.id) } })
    }
  }

  return (
    <ul className="space-y-1.5">
      {routines.map((dump) => (
        <li key={dump.id} className="flex items-center gap-2.5 rounded-xl border border-dashed border-line px-3 py-2.5">
          <Repeat className="size-4 shrink-0 text-ink-subtle" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{titleFromDump(dump.content)}</span>
          <span className="shrink-0 text-xs text-ink-subtle">Routine, adds itself</span>
        </li>
      ))}
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2">
          <span className="w-4 shrink-0 text-center text-xs font-semibold text-ink-subtle tabular-nums" aria-hidden>
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{item.data.title}</p>
            {item.data.firstAction && <p className="truncate text-xs text-ink-subtle">{item.data.firstAction}</p>}
          </div>
          <button
            type="button"
            onClick={() => void toggleType(item)}
            className={cn('inline-flex shrink-0 items-center rounded-full pointer-coarse:min-h-10 pointer-coarse:px-2', focusRing)}
            aria-label={`${item.data.type === 'block' ? 'Block' : 'Task'}: change to ${item.data.type === 'block' ? 'Task' : 'Block'}`}
            title="Switch Block / Task"
          >
            <TypeBadge type={item.data.type} />
          </button>
          <button
            type="button"
            onClick={() => void remove(item)}
            className={cn('grid size-8 shrink-0 place-items-center rounded-lg text-ink-subtle hover:bg-sunken hover:text-ink pointer-coarse:size-10', focusRing)}
            aria-label={`Remove "${preview(item.data.title, 40)}" from tomorrow`}
          >
            <X className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function TomorrowPicker({ view, dumps, exclude, routineIds }: { view: TodayView; dumps: Dump[]; exclude: Set<string>; routineIds: Set<string> }) {
  const planner = usePlanner()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const rank = (d: Dump) => {
      const meta = view.metas.get(d.id)
      return meta?.resumeNote.trim() ? 0 : meta?.repeat?.length ? 1 : 2
    }
    return dumps
      .filter((d) => !exclude.has(d.id) && !routineIds.has(d.id))
      .map((d, i) => ({ d, i, r: rank(d) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map(({ d }) => d)
  }, [dumps, exclude, routineIds, view.metas])

  const searching = query.trim() !== ''
  const matches = candidates.filter((d) => matchesQuery(d, query))
  const shown = searching || expanded ? matches : matches.slice(0, PICKER_PREVIEW)

  const add = async (dump: Dump) => {
    setAdding(dump.id)
    const result = await planner.addFromDump(dump, view.tomorrow)
    setAdding(null)
    if (result.ok) {
      const id = result.id
      toast.success('Added to tomorrow', { description: preview(dump.content), action: { label: 'Undo', onClick: () => void planner.removeItem(id) } })
    } else if (result.reason === 'full') {
      const type = view.metas.get(dump.id)?.defaultType ?? 'task'
      toast.error('Tomorrow is full', {
        description: type === 'block' ? `${view.settings.blockCap} Blocks is the cap. Remove one first.` : `${view.settings.taskCap} Tasks is the cap. Remove one first.`,
      })
    } else if (result.reason === 'exists') {
      toast('Already in tomorrow')
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium text-ink">Add from your board</h3>
      {candidates.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No more tiles on your board.{' '}
          <Link to="/" className={cn('rounded text-accent underline-offset-2 hover:underline', focusRing)}>
            Dump something first
          </Link>
          .
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search your board"
              aria-label="Search your board"
              className={cn(inputClass, 'h-10 pl-9 [&::-webkit-search-cancel-button]:hidden')}
            />
          </div>
          {shown.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No tiles match “{query.trim()}”.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {shown.map((dump) => {
                const meta = view.metas.get(dump.id)
                const note = meta?.resumeNote.trim()
                return (
                  <li key={dump.id}>
                    <button
                      type="button"
                      onClick={() => void add(dump)}
                      disabled={adding !== null}
                      aria-label={`Add "${preview(dump.content, 50)}" to tomorrow`}
                      className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-sunken disabled:opacity-60', focusRing)}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                        <Plus className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{preview(dump.content, 90)}</span>
                        {note && (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-accent">
                            <Bookmark className="size-3 shrink-0" aria-hidden />
                            <span className="truncate">Bookmark: {note}</span>
                          </span>
                        )}
                      </span>
                      {meta?.defaultType === 'block' && <TypeBadge type="block" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {!searching && matches.length > PICKER_PREVIEW && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={cn('mt-2 rounded-md px-1 text-sm font-medium text-accent underline-offset-2 hover:underline', focusRing)}
            >
              {expanded ? 'Show fewer' : `Show all ${matches.length} tiles`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ---- 3. Block 1 ---------------------------------------------------------------------------

function Block1Fields({
  block,
  meta,
  firstAction,
  minimum,
  onChange,
  onSave,
}: {
  block: Doc<TodayItem>
  meta: TileMeta | undefined
  firstAction: string
  minimum: string
  onChange: (patch: { firstAction?: string; minimum?: string }) => void
  onSave: () => void
}) {
  const faId = useId()
  const minId = useId()
  const words = firstAction.trim() ? firstAction.trim().split(/\s+/).length : 0
  const tooLong = words > FIRST_ACTION_WORDS
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div>
      <p className="text-sm font-medium break-words text-ink">
        {block.data.title}
        <span className="ml-2 text-xs font-normal text-ink-subtle">{block.data.minutes} min</span>
      </p>
      {meta?.resumeNote.trim() && (
        <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
          <Bookmark className="size-3 shrink-0 text-accent" aria-hidden />
          <span className="truncate">Bookmark: {meta.resumeNote.trim()}</span>
        </p>
      )}
      <div className="mt-3 space-y-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor={faId} className="text-sm font-medium text-ink">
              First action (≤10 words)
            </label>
            <span className={cn('text-xs tabular-nums', tooLong ? 'text-danger' : 'text-ink-subtle')} aria-live="polite">
              {words}/{FIRST_ACTION_WORDS}
            </span>
          </div>
          <input
            id={faId}
            value={firstAction}
            onChange={(e) => onChange({ firstAction: e.target.value })}
            onBlur={onSave}
            onKeyDown={onEnter}
            maxLength={200}
            placeholder="Pen in hand, PSIR index p.14, read heading 3"
            className={inputClass}
            autoComplete="off"
          />
          {tooLong && <p className="mt-1.5 text-xs text-danger">Shorter is easier at 4 AM. One physical action.</p>}
        </div>
        <div>
          <label htmlFor={minId} className="mb-1.5 block text-sm font-medium text-ink">
            Minimum
          </label>
          <input
            id={minId}
            value={minimum}
            onChange={(e) => onChange({ minimum: e.target.value })}
            onBlur={onSave}
            onKeyDown={onEnter}
            maxLength={200}
            placeholder="5 bullet notes"
            className={inputClass}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  )
}

function NoBlockHint({ view, items, collapsed, onShowAll }: { view: TodayView; items: Array<Doc<TodayItem>>; collapsed: boolean; onShowAll: () => void }) {
  const planner = usePlanner()
  const tasks = items.filter((i) => i.data.type === 'task')

  const makeBlock = async (item: Doc<TodayItem>) => {
    const others = view.tomorrowItems.filter((i) => i.id !== item.id)
    if (!item.data.habit && !hasRoomFor('block', others, view.settings)) {
      toast.error(`Tomorrow already has ${view.settings.blockCap} Blocks`)
      return
    }
    await planner.updateItem(item.id, { type: 'block' })
  }

  return (
    <div className="text-sm text-ink-muted">
      <p>No Block in tomorrow's queue yet. Block 1 is the next unit from its Bookmark.</p>
      {tasks.length > 0 ? (
        <>
          <p className="mt-2">Make one a Block:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tasks.map((item) => (
              <button key={item.id} type="button" onClick={() => void makeBlock(item)} className={cn(chipClass(), 'max-w-full')}>
                <span className="truncate">{preview(item.data.title, 40)}</span>
              </button>
            ))}
          </div>
        </>
      ) : collapsed ? (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onShowAll}>
          <Plus aria-hidden />
          Pick Block 1
        </Button>
      ) : (
        <p className="mt-2">Add one from your board above, then switch it to a Block.</p>
      )}
    </div>
  )
}
