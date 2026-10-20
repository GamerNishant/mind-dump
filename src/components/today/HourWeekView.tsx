import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { percent, weekOf, weekSummary, type CategoryTotal } from '@/lib/hours'
import { addDays, dateOfDay } from '@/lib/plan'
import { usePlannerState } from '@/state/PlannerProvider'
import { CATEGORY_FILL, CategoryBadge, SHORT_LABEL } from './hourStyles'

/** Dated planner docs older than this aren't loaded (PlannerProvider HISTORY_DAYS is 45). */
const OLDEST_WEEK_START_DAYS = 42

const fmt = (day: string, opts: Intl.DateTimeFormatOptions) => dateOfDay(day).toLocaleDateString(undefined, opts)

/**
 * Where the hours went, Monday to Sunday: one stacked bar per day (scaled to 24 hours, so days
 * compare honestly) and a totals table with shares and the change from the week before.
 */
export function HourWeekView({ today }: { today: string }) {
  const { docs } = usePlannerState()
  const [offset, setOffset] = useState(0)
  const days = useMemo(() => weekOf(today, offset), [today, offset])
  const week = useMemo(() => weekSummary(docs, days), [docs, days])
  const previous = useMemo(() => weekSummary(docs, weekOf(today, offset - 1)), [docs, today, offset])
  const prevHours = new Map(previous.totals.map((t) => [t.category, t.hours]))
  const canGoBack = weekOf(today, offset - 1)[0] >= addDays(today, -OLDEST_WEEK_START_DAYS)
  const top = week.totals[0]

  const range = `${fmt(days[0], { month: 'short', day: 'numeric' })} – ${fmt(days[6], { month: 'short', day: 'numeric' })}`
  const title = offset === 0 ? 'This week' : offset === -1 ? 'Last week' : range

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={() => setOffset((o) => o - 1)} disabled={!canGoBack} aria-label="Previous week">
          <ChevronLeft aria-hidden />
        </Button>
        <p className="min-w-0 flex-1 text-center text-sm font-medium text-ink" aria-live="polite">
          {title}
          {offset > -2 && <span className="ml-1.5 text-xs font-normal text-ink-subtle">{range}</span>}
        </p>
        <Button variant="ghost" size="icon-sm" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} aria-label="Next week">
          <ChevronRight aria-hidden />
        </Button>
      </div>

      {week.logged === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">
          No hours logged {offset === 0 ? 'this week yet' : 'that week'}. Switch to Day and tap a few hours.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink">
            <span className="font-semibold tabular-nums">{week.logged}h</span> logged on {week.activeDays} of 7 days
            {top && (
              <>
                {' · '}most went to <span className="font-semibold">{SHORT_LABEL[top.category]}</span>{' '}
                <span className="tabular-nums">({percent(top.hours, week.logged)}%)</span>
              </>
            )}
          </p>

          <ol aria-label="Hours per day" className="mt-3 space-y-1.5">
            {week.days.map(({ day, total, segments }) => {
              const future = day > today
              const label = fmt(day, { weekday: 'short' })
              const describe = segments.map((s) => `${SHORT_LABEL[s.category]} ${s.hours}h`).join(', ')
              return (
                <li key={day} className="flex items-center gap-2">
                  <span className={cn('w-9 shrink-0 text-xs', day === today ? 'font-semibold text-ink' : 'text-ink-muted')}>{label}</span>
                  <div className="h-4 min-w-0 flex-1 rounded-r bg-sunken" title={total ? `${label}: ${describe}` : undefined}>
                    <div className="flex h-full gap-[2px]" style={{ width: `${(total / 24) * 100}%` }}>
                      {segments.map((s, i) => (
                        <span
                          key={s.category}
                          title={`${label} · ${SHORT_LABEL[s.category]} ${s.hours}h${s.tags.length ? ` (${s.tags.map((t) => `${t.tag} ${t.hours}h`).join(', ')})` : ''}`}
                          className={cn('block h-full min-w-[3px]', CATEGORY_FILL[s.category], i === segments.length - 1 && 'rounded-r')}
                          style={{ flexGrow: s.hours, flexBasis: 0 }}
                        />
                      ))}
                    </div>
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs text-ink-muted tabular-nums">
                    {future ? '' : `${total}h`}
                    <span className="sr-only">{total ? `: ${describe}` : ''}</span>
                  </span>
                </li>
              )
            })}
          </ol>

          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">Hours by category, {title}</caption>
            <thead>
              <tr className="text-xs text-ink-subtle">
                <th scope="col" className="pb-1 text-left font-medium">
                  Category
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Hours
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Share
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  <span className="max-sm:hidden">vs week before</span>
                  <span className="sm:hidden">Δ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {week.totals.map((t) => (
                <TotalRow key={t.category} total={t} logged={week.logged} previous={prevHours.get(t.category) ?? 0} hasPrevious={previous.logged > 0} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function TotalRow({ total, logged, previous, hasPrevious }: { total: CategoryTotal; logged: number; previous: number; hasPrevious: boolean }) {
  const delta = total.hours - previous
  return (
    <>
      <tr className="border-t border-line">
        <th scope="row" className="py-1.5 text-left font-normal">
          <span className="inline-flex items-center gap-2 text-ink">
            <CategoryBadge parsed={{ category: total.category, tag: null }} className="size-4 rounded" />
            {SHORT_LABEL[total.category]}
          </span>
        </th>
        <td className="py-1.5 text-right font-medium text-ink tabular-nums">{total.hours}h</td>
        <td className="py-1.5 text-right text-ink-muted tabular-nums">{percent(total.hours, logged)}%</td>
        <td className="py-1.5 text-right text-xs text-ink-muted tabular-nums">
          {!hasPrevious ? '–' : delta === 0 ? 'same' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}h`}
        </td>
      </tr>
      {total.tags.map((t) => (
        <tr key={t.tag}>
          <th scope="row" className="py-0.5 pl-6 text-left text-xs font-normal text-ink-muted">
            {t.tag}
          </th>
          <td className="py-0.5 text-right text-xs text-ink-muted tabular-nums">{t.hours}h</td>
          <td className="py-0.5 text-right text-xs text-ink-subtle tabular-nums">{percent(t.hours, logged)}%</td>
          <td />
        </tr>
      ))}
    </>
  )
}
