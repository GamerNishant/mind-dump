import { useId, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import { dayLabel } from '@/lib/plan'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'

/**
 * Spec #11 Restart: open items from before yesterday aren't carried silently. One card offers a
 * clean Restart (they go back to the dump, Bookmarks kept) or bringing them into today.
 * Renders nothing when there is nothing stale.
 */
export function RestartCard({ view }: { view: TodayView }) {
  const planner = usePlanner()
  const titleId = useId()
  const [busy, setBusy] = useState<'restart' | 'bring' | null>(null)

  if (view.status !== 'ready' || view.stale.length === 0) return null

  const ids = view.stale.map((s) => s.id)
  const n = ids.length
  const noun = n === 1 ? 'item' : 'items'

  const restart = async () => {
    setBusy('restart')
    const ok = await planner.restart(view.today, ids)
    setBusy(null)
    if (ok) toast.success('Fresh start. Floor only today: Block 1 + Shutdown.')
  }

  const bringBack = async () => {
    setBusy('bring')
    const { brought, left } = await planner.bringBack(view.today, ids)
    setBusy(null)
    // Items that didn't fit stay stale, so this card stays up for them.
    if (left > 0) toast.success(`Brought ${brought} into today. ${left} didn't fit the caps — they're still here.`)
    else if (brought > 0) toast.success(`Brought ${brought} into today.`)
    else toast.success('Already in today.')
  }

  return (
    <section
      aria-labelledby={titleId}
      className="animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <RotateCcw className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Welcome back. No backlog.
          </h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            You have {n} unfinished {noun} from before yesterday. Restart sends {n === 1 ? 'it' : 'them'} back to
            the dump with Bookmarks kept. Today is the Floor only.
          </p>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-line bg-sunken">
        <summary className="cursor-pointer rounded-xl px-3 py-2 text-sm font-medium text-ink-muted select-none hover:text-ink">
          Show {n} {noun}
        </summary>
        <ul className="max-h-64 divide-y divide-line overflow-y-auto border-t border-line">
          {view.stale.map((item) => (
            <li key={item.id} className="flex items-baseline gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.data.title}</span>
              {item.day && <span className="shrink-0 text-xs text-ink-subtle">{dayLabel(item.day, view.today)}</span>}
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="pointer-coarse:h-10" onClick={() => void restart()} loading={busy === 'restart'} disabled={busy !== null}>
          <RotateCcw aria-hidden />
          Restart
        </Button>
        <Button
          variant="secondary"
          className="pointer-coarse:h-10"
          onClick={() => void bringBack()} loading={busy === 'bring'}
          disabled={busy !== null}
        >
          {n === 1 ? 'Bring it into today' : 'Bring them into today'}
        </Button>
      </div>
    </section>
  )
}
