import { useId, useState } from 'react'
import { ArrowRight, Check, Sunrise, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, focusRing } from '@/components/ui'
import { ChoiceChips } from '@/components/today/SkipSheet'
import type { Block1Result } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'

/** The check is offered from the start of the planner day until 2 PM. */
const CHECK_UNTIL_HOUR = 14

const RESULTS: ReadonlyArray<{ value: Block1Result; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No' },
]

type Step = 'block1' | 'carried' | 'floor'

/** Whether TodayPage should show the Morning Check right now. */
export function wantsMorningCheck(view: TodayView): boolean {
  const hour = view.now.getHours()
  return (
    view.status === 'ready' &&
    !view.plan.morningCheckAt &&
    hour >= view.settings.dayStartHour &&
    hour < CHECK_UNTIL_HOUR &&
    // A pending Restart decision comes first; one card at a time.
    view.stale.length === 0
  )
}

/**
 * Spec #8: log the paper Block 1, decide on carried items, see the Floor. Under 2 minutes,
 * never blocks the Queue, and dismissing it counts as done. Renders nothing when not due.
 */
export function MorningCheckCard({ view }: { view: TodayView }) {
  const planner = usePlanner()
  const titleId = useId()
  const noteId = useId()
  const [step, setStep] = useState<Step>('block1')
  const [result, setResult] = useState<Block1Result | null>(null)
  /** null = untouched, show the tile's Bookmark. */
  const [note, setNote] = useState<string | null>(null)
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!wantsMorningCheck(view)) return null

  const block = planner.block1(view.today)
  const bookmark = block?.data.dumpId ? (view.metas.get(block.data.dumpId)?.resumeNote ?? '') : ''
  const stoppedAt = note ?? bookmark
  const chosen = result ?? (block?.data.status === 'done' && block.data.minMet ? 'yes' : null)
  const carried = view.items.filter((i) => i.data.carriedFrom && i.data.status === 'open' && i.id !== block?.id)
  const steps: Step[] = carried.length ? ['block1', 'carried', 'floor'] : ['block1', 'floor']
  // Carried items may all be resolved while on that step: move on.
  const current: Step = steps.includes(step) ? step : 'floor'
  const index = steps.indexOf(current)
  const next = () => setStep(steps[Math.min(index + 1, steps.length - 1)])

  const finish = async (withResult: boolean) => {
    setBusy(true)
    // The typed note is saved even when dismissing; only a typed (non-null) note counts there.
    const ok = await planner.morningCheck(
      view.today,
      withResult && block ? chosen : null,
      withResult ? stoppedAt : (note ?? ''),
    )
    setBusy(false)
    if (ok && withResult) toast.success('Morning Check done. Floor today: Block 1 + Shutdown.')
  }

  const notToday = async (id: string, title: string) => {
    setConfirming(null)
    const ok = await planner.skip(id, 'not_today', 'dump')
    if (ok)
      toast.success('Back to the dump', {
        description: title,
        action: { label: 'Undo', onClick: () => void planner.reopen(id) },
      })
  }

  return (
    <section
      aria-labelledby={titleId}
      className="animate-fade-up relative rounded-2xl border border-line bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start gap-3 pr-8">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Sunrise className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Morning Check
          </h2>
          <p className="text-xs text-ink-subtle">
            Step {index + 1} of {steps.length} · under 2 minutes
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void finish(false)}
        disabled={busy}
        className={cn(
          'absolute top-3 right-3 grid size-8 place-items-center pointer-coarse:size-10 rounded-lg text-ink-subtle hover:bg-sunken hover:text-ink',
          focusRing,
        )}
        aria-label="Dismiss Morning Check"
      >
        <X className="size-4" aria-hidden />
      </button>

      <div className="mt-4">
        {current === 'block1' &&
          (block ? (
            <div className="space-y-4">
              <div>
                <p className="truncate text-sm font-medium text-ink">Block 1: {block.data.title}</p>
                {block.data.minimum && <p className="text-xs text-ink-subtle">Minimum: {block.data.minimum}</p>}
                <ChoiceChips
                  label="Block 1 minimum met?"
                  options={RESULTS}
                  value={chosen}
                  onChange={setResult}
                  className="mt-2.5"
                />
              </div>
              <div>
                <label htmlFor={noteId} className="block text-sm font-medium text-ink">
                  Stopped at?
                </label>
                <input
                  id={noteId}
                  value={stoppedAt}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      next()
                    }
                  }}
                  placeholder="e.g. PSIR p.42, Locke done"
                  maxLength={200}
                  enterKeyHint="next"
                  className="mt-1.5 h-11 w-full rounded-xl border border-line bg-card px-3.5 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
                />
                <p className="mt-1 text-xs text-ink-subtle">This becomes the Bookmark: the next first action.</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No block queued. Add one below, or open the Bookmark.</p>
          ))}

        {current === 'carried' && (
          <div>
            <p className="text-sm font-medium text-ink">Carried from yesterday</p>
            <p className="mt-0.5 text-xs text-ink-subtle">Keep it in today, or send it back to the dump.</p>
            <ul className="mt-2.5 divide-y divide-line rounded-xl border border-line">
              {carried.map((item) => {
                const isKept = kept.has(item.id)
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block truncate text-sm text-ink">{item.data.title}</span>
                      {item.data.carryCount > 1 && (
                        <span className="text-xs text-ink-subtle">Carried ×{item.data.carryCount}</span>
                      )}
                    </span>
                    {confirming === item.id ? (
                      <span className="flex gap-1.5">
                        <Button className="pointer-coarse:h-10" size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                        <Button className="pointer-coarse:h-10" size="sm" variant="danger-ghost" onClick={() => void notToday(item.id, item.data.title)}>
                          Not today
                        </Button>
                      </span>
                    ) : (
                      <span className="flex gap-1.5">
                        <Button
                          className="pointer-coarse:h-10"
                          size="sm"
                          variant={isKept ? 'ghost' : 'secondary'}
                          aria-pressed={isKept}
                          onClick={() => setKept((s) => new Set(s).add(item.id))}
                        >
                          {isKept && <Check aria-hidden />}
                          {isKept ? 'Kept' : 'Keep'}
                        </Button>
                        <Button className="pointer-coarse:h-10" size="sm" variant="ghost" onClick={() => setConfirming(item.id)}>
                          Back to dump
                        </Button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {current === 'floor' && (
          <div className="rounded-xl bg-accent-soft px-3.5 py-3">
            <p className="text-sm font-semibold text-ink">Floor today = Block 1 + Shutdown</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {view.missedYesterday
                ? 'Never miss twice: Block 1 minimum today, no matter what.'
                : 'Hit that and the day is a win. Everything else is extra.'}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => void finish(false)}
          disabled={busy}
          className={cn('rounded-md px-1 text-sm text-ink-subtle pointer-coarse:h-10 pointer-coarse:px-2 hover:text-ink disabled:opacity-50', focusRing)}
        >
          Skip check
        </button>
        <div className="flex gap-2">
          {index > 0 && (
            <Button className="pointer-coarse:h-10" variant="ghost" size="sm" onClick={() => setStep(steps[index - 1])} disabled={busy}>
              Back
            </Button>
          )}
          {current === 'floor' ? (
            <Button className="pointer-coarse:h-10" size="sm" onClick={() => void finish(true)} loading={busy}>
              <Check aria-hidden />
              Done
            </Button>
          ) : (
            <Button className="pointer-coarse:h-10" size="sm" onClick={next} disabled={busy}>
              Next
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
