import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button, focusRing } from '@/components/ui'
import { HOUR_CATEGORIES, HOUR_CATEGORY_LABEL, type HourCategory } from '@/domain/plan'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/cn'
import { hourLogOf, hourSummary, stripHours } from '@/lib/plan'
import { usePlanner, usePlannerState, useToday } from '@/state/PlannerProvider'

/** Cell fill per category. Translucent palette colours read on both the light and dark card. */
const CATEGORY_STYLE: Record<HourCategory, { fill: string; text: string }> = {
  study: { fill: 'bg-emerald-500/80', text: 'text-white' },
  phone: { fill: 'bg-rose-500/70', text: 'text-white' },
  sleep: { fill: 'bg-indigo-500/70', text: 'text-white' },
  food: { fill: 'bg-amber-500/70', text: 'text-zinc-950' },
  build: { fill: 'bg-violet-500/70', text: 'text-white' },
  chores: { fill: 'bg-sky-500/70', text: 'text-zinc-950' },
  leisure: { fill: 'bg-fuchsia-500/60', text: 'text-white' },
  other: { fill: 'bg-zinc-400/60', text: 'text-zinc-950' },
}

/** Short names for chips and the summary line ("Phone 4h", not "Phone / random 4h"). */
const SHORT_LABEL: Record<HourCategory, string> = { ...HOUR_CATEGORY_LABEL, phone: 'Phone' }

const LONG_PRESS_MS = 450

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'

/** "4a", "12p". */
function shortHour(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`
}

/** "4 AM", "12 PM". */
function longHour(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * "Where did the time go?": a 24-cell hour log for one planner day (spec #7). Tap cells to
 * select (shift-click or long-press selects a range), then pick a category from the chip bar.
 */
export function HourLogStrip({ day, defaultOpen = false }: { day: string; defaultOpen?: boolean }) {
  const planner = usePlanner()
  const { docs, status } = usePlannerState()
  const view = useToday()
  const [open, setOpen] = usePersistentState('minddump:hourlog-open', defaultOpen, isBool)
  const bodyId = useId()
  const headingId = useId()

  const hours = useMemo(() => stripHours(view.settings.dayStartHour), [view.settings.dayStartHour])
  const log = useMemo(() => hourLogOf(docs, day), [docs, day])
  const summary = useMemo(() => hourSummary(log), [log])

  // Strip index of the current clock hour: cells after it haven't happened yet.
  const nowIndex = day === view.today ? hours.indexOf(view.now.getHours()) : day < view.today ? hours.length : -1
  const isFuture = (index: number) => index > nowIndex

  // Completed hours (before the current one) with nothing logged.
  const unlogged = hours.filter((h, i) => i < nowIndex && !log.hours[String(h)]).length

  // Selection is per day; switching days starts fresh.
  const [selection, setSelection] = useState<{ day: string; hours: number[]; anchor: number | null }>({ day, hours: [], anchor: null })
  const selected = selection.day === day ? selection.hours : []
  const anchor = selection.day === day ? selection.anchor : null
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const clearSelection = () => setSelection({ day, hours: [], anchor: null })

  const toggle = (hour: number) => {
    const has = selectedSet.has(hour)
    setSelection({ day, hours: has ? selected.filter((h) => h !== hour) : [...selected, hour], anchor: has ? anchor : hour })
  }

  /** Add every selectable cell between the anchor (or the last selected cell) and `hour`. */
  const selectRange = (hour: number) => {
    const from = anchor ?? selected.at(-1)
    if (from === undefined || from === null) return toggle(hour)
    const a = hours.indexOf(from)
    const b = hours.indexOf(hour)
    const range = hours.slice(Math.min(a, b), Math.max(a, b) + 1).filter((_, i) => !isFuture(Math.min(a, b) + i))
    setSelection({ day, hours: [...new Set([...selected, ...range])], anchor: hour })
  }

  // Long-press (touch): select a range from the last selected cell.
  const pressTimer = useRef<number | null>(null)
  const longPressed = useRef(false)
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  useEffect(() => cancelPress, [])

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, hour: number) => {
    longPressed.current = false
    if (e.pointerType !== 'touch') return
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      longPressed.current = true
      selectRange(hour)
      navigator.vibrate?.(10)
    }, LONG_PRESS_MS)
  }

  const onCellClick = (e: MouseEvent<HTMLButtonElement>, hour: number) => {
    if (longPressed.current) {
      // The long-press already handled this touch.
      longPressed.current = false
      return
    }
    if (e.shiftKey) selectRange(hour)
    else toggle(hour)
  }

  const apply = (category: HourCategory | null) => {
    const target = selected
    clearSelection()
    void planner.setHours(day, target, category)
  }

  const ready = status === 'ready'
  const summaryText = summary.map((s) => `${SHORT_LABEL[s.category]} ${s.hours}h`).join(' · ')

  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-card shadow-xs">
      <h2 id={headingId}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cn('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left', focusRing)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight text-ink">Where did the time go?</span>
            {!open && (summaryText || unlogged > 0) && (
              <span className="mt-0.5 block truncate text-xs font-normal text-ink-subtle">
                {summaryText || `${plural(unlogged, 'hour')} unlogged`}
              </span>
            )}
          </span>
          <ChevronDown className={cn('size-5 shrink-0 text-ink-subtle transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
        </button>
      </h2>

      {open && (
        <div
          id={bodyId}
          className="border-t border-line px-4 pt-3 pb-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && selected.length) {
              e.stopPropagation()
              clearSelection()
            }
          }}
        >
          <p className="text-xs text-ink-muted">
            Tap hours to select them, then pick what they were.{' '}
            <span className="max-sm:hidden">Shift-click selects a range.</span>
            <span className="sm:hidden">Long-press selects a range.</span>
          </p>

          <div role="group" aria-label="Hours of the day" className="mt-3 grid grid-cols-8 gap-1 sm:grid-cols-12">
            {hours.map((hour, index) => {
              const category = log.hours[String(hour)]
              const future = isFuture(index)
              const isSelected = selectedSet.has(hour)
              const style = category ? CATEGORY_STYLE[category] : null
              return (
                <button
                  key={hour}
                  type="button"
                  disabled={future || !ready}
                  aria-pressed={future ? undefined : isSelected}
                  aria-label={`${longHour(hour)}: ${future ? 'later' : category ? HOUR_CATEGORY_LABEL[category] : 'not logged'}`}
                  onClick={(e) => onCellClick(e, hour)}
                  onPointerDown={(e) => onPointerDown(e, hour)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(e) => e.preventDefault()}
                  className={cn(
                    'relative h-10 min-w-0 touch-manipulation rounded-lg text-[11px] font-medium tabular-nums select-none [-webkit-touch-callout:none]',
                    'transition-[box-shadow,transform,opacity] duration-100 motion-reduce:transition-none',
                    focusRing,
                    style ? cn(style.fill, style.text) : 'border border-line bg-sunken text-ink-muted',
                    future ? 'cursor-default border-dashed opacity-40' : 'hover:brightness-105 active:scale-95 motion-reduce:active:scale-100',
                    isSelected && 'ring-2 ring-accent ring-offset-2 ring-offset-card',
                    index === nowIndex && !isSelected && 'outline-2 outline-offset-1 outline-line-strong outline-dashed',
                  )}
                >
                  {shortHour(hour)}
                </button>
              )
            })}
          </div>

          {selected.length > 0 && (
            <div role="group" aria-label={`Mark ${plural(selected.length, 'hour')} as`} className="animate-fade-up mt-3 rounded-xl border border-line bg-elevated p-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium text-ink">Mark {plural(selected.length, 'hour')} as:</p>
                <Button variant="ghost" size="icon-sm" onClick={clearSelection} aria-label="Cancel selection">
                  <X aria-hidden />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {HOUR_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => apply(c)}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card pr-3 pl-2 text-sm text-ink hover:border-line-strong hover:bg-sunken',
                      focusRing,
                    )}
                  >
                    <span className={cn('size-3 rounded-full', CATEGORY_STYLE[c].fill)} aria-hidden />
                    {SHORT_LABEL[c]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => apply(null)}
                  className={cn('inline-flex h-9 items-center rounded-full px-3 text-sm text-ink-muted hover:bg-sunken hover:text-ink', focusRing)}
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
            {HOUR_CATEGORIES.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                <span className={cn('size-2.5 rounded-sm', CATEGORY_STYLE[c].fill)} aria-hidden />
                {HOUR_CATEGORY_LABEL[c]}
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-0.5 text-sm">
            <p className="text-ink">{summaryText || <span className="text-ink-subtle">Nothing logged yet.</span>}</p>
            {unlogged > 0 && (
              <p className="text-xs text-ink-subtle">
                {plural(unlogged, 'hour')} unlogged {day === view.today ? 'since morning' : 'that day'}. A rough guess is fine.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
