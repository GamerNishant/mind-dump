import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { Button, focusRing } from '@/components/ui'
import { HOUR_CATEGORIES, MAX_TAG_LENGTH, type HourValue } from '@/domain/plan'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/cn'
import { cleanTag, hourLabel, hourValue, parseHour, summarize } from '@/lib/hours'
import { hourLogOf, stripHours } from '@/lib/plan'
import { usePlanner, usePlannerState, useToday } from '@/state/PlannerProvider'
import { CATEGORY_FILL, CategoryBadge, initialOf, longHour, plural, SHORT_LABEL, shortHour } from './hourStyles'
import { HourWeekView } from './HourWeekView'

const LONG_PRESS_MS = 450

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
type View = 'day' | 'week'
const isView = (v: unknown): v is View => v === 'day' || v === 'week'

/** The categories offered as one-tap chips (Other has its own "name it" flow). */
const QUICK_CATEGORIES = HOUR_CATEGORIES.filter((c) => c !== 'other')

/**
 * "Where did the time go?": a 24-cell hour log for one planner day, and a Week view of where the
 * hours went. Tap cells to select (shift-click or long-press selects a range), then pick what
 * they were. "Other…" asks what it was and remembers the name as a quick pick.
 */
export function HourLogStrip({ day, defaultOpen = false }: { day: string; defaultOpen?: boolean }) {
  const planner = usePlanner()
  const { docs, status } = usePlannerState()
  const view = useToday()
  const [open, setOpen] = usePersistentState('minddump:hourlog-open', defaultOpen, isBool)
  const [mode, setMode] = usePersistentState<View>('minddump:hourlog-view', 'day', isView)
  const bodyId = useId()
  const headingId = useId()

  const hours = useMemo(() => stripHours(view.settings.dayStartHour), [view.settings.dayStartHour])
  const log = useMemo(() => hourLogOf(docs, day), [docs, day])
  const summary = useMemo(() => summarize([log]), [log])
  const tags = view.settings.otherTags ?? []

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
  const [naming, setNaming] = useState(false)
  const clearSelection = () => {
    setSelection({ day, hours: [], anchor: null })
    setNaming(false)
  }

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

  const apply = (value: HourValue | null) => {
    const target = selected
    clearSelection()
    void planner.setHours(day, target, value)
  }

  /** "Other…" answered: store the name (and remember it) or plain Other when left blank. */
  const applyOther = (name: string) => {
    const value = hourValue('other', name)
    const parsed = parseHour(value)
    if (parsed?.tag) void planner.addOtherTag(parsed.tag)
    apply(value)
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
        <div id={bodyId} className="border-t border-line px-4 pt-3 pb-4">
          <div role="tablist" aria-label="Time view" className="inline-flex gap-1 rounded-xl bg-sunken p-1">
            {(['day', 'week'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'h-8 rounded-lg px-4 text-xs font-medium transition pointer-coarse:h-9',
                  mode === m ? 'bg-card text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-muted hover:text-ink',
                  focusRing,
                )}
              >
                {m === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>

          {mode === 'week' ? (
            <HourWeekView today={view.today} />
          ) : (
            <div
              className="mt-3"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && selected.length) {
                  e.stopPropagation()
                  clearSelection()
                }
              }}
            >
              <p className="text-xs text-ink-muted">
                Tap hours to select them, then pick what they were.{' '}
                <span className="pointer-coarse:hidden">Shift-click selects a range.</span>
                <span className="pointer-fine:hidden">Long-press selects a range.</span>
              </p>

              <div role="group" aria-label="Hours of the day" className="mt-3 grid grid-cols-8 gap-1 sm:grid-cols-12">
                {hours.map((hour, index) => {
                  const parsed = parseHour(log.hours[String(hour)])
                  const future = isFuture(index)
                  const isSelected = selectedSet.has(hour)
                  return (
                    <button
                      key={hour}
                      type="button"
                      disabled={future || !ready}
                      aria-pressed={future ? undefined : isSelected}
                      aria-label={`${longHour(hour)}: ${future ? 'later' : parsed ? hourLabel(parsed) : 'not logged'}`}
                      title={parsed ? hourLabel(parsed) : undefined}
                      onClick={(e) => onCellClick(e, hour)}
                      onPointerDown={(e) => onPointerDown(e, hour)}
                      onPointerUp={cancelPress}
                      onPointerLeave={cancelPress}
                      onPointerCancel={cancelPress}
                      onContextMenu={(e) => e.preventDefault()}
                      className={cn(
                        'relative flex h-10 min-w-0 touch-manipulation flex-col items-center justify-center rounded-lg text-[11px] leading-none font-medium tabular-nums select-none [-webkit-touch-callout:none]',
                        'transition-[box-shadow,transform,opacity] duration-100 motion-reduce:transition-none',
                        focusRing,
                        parsed ? cn(CATEGORY_FILL[parsed.category], 'text-white') : 'border border-line bg-sunken text-ink-muted',
                        future ? 'cursor-default border-dashed opacity-40' : 'hover:brightness-105 active:scale-95 motion-reduce:active:scale-100',
                        isSelected && 'ring-2 ring-accent ring-offset-2 ring-offset-card',
                        index === nowIndex && !isSelected && 'outline-2 outline-offset-1 outline-line-strong outline-dashed',
                      )}
                    >
                      <span aria-hidden>{shortHour(hour)}</span>
                      {parsed && (
                        <span aria-hidden className="mt-0.5 text-[10px] font-bold tracking-wide">
                          {initialOf(parsed)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {selected.length > 0 && (
                <div role="group" aria-label={`Mark ${plural(selected.length, 'hour')} as`} className="animate-fade-up mt-3 rounded-xl border border-line bg-elevated p-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium text-ink">
                      {naming ? 'What was it?' : `Mark ${plural(selected.length, 'hour')} as:`}
                    </p>
                    <Button variant="ghost" size="icon-sm" onClick={clearSelection} aria-label="Cancel selection">
                      <X aria-hidden />
                    </Button>
                  </div>
                  {naming ? (
                    <OtherNamer tags={tags} onPick={applyOther} onForget={(t) => void planner.removeOtherTag(t)} onBack={() => setNaming(false)} />
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUICK_CATEGORIES.map((c) => (
                        <ChipButton key={c} onClick={() => apply(c)}>
                          <CategoryBadge parsed={{ category: c, tag: null }} className="size-5 rounded-full" />
                          {SHORT_LABEL[c]}
                        </ChipButton>
                      ))}
                      {tags.map((t) => (
                        <ChipButton key={t} onClick={() => apply(hourValue('other', t))}>
                          <CategoryBadge parsed={{ category: 'other', tag: t }} className="size-5 rounded-full" />
                          {t}
                        </ChipButton>
                      ))}
                      <ChipButton onClick={() => setNaming(true)}>
                        <CategoryBadge parsed={{ category: 'other', tag: null }} className="size-5 rounded-full" />
                        Other…
                      </ChipButton>
                      <button
                        type="button"
                        onClick={() => apply(null)}
                        className={cn('inline-flex h-9 items-center rounded-full px-3 text-sm text-ink-muted hover:bg-sunken hover:text-ink pointer-coarse:h-10', focusRing)}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}

              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
                {QUICK_CATEGORIES.map((c) => (
                  <li key={c} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                    <CategoryBadge parsed={{ category: c, tag: null }} className="size-4 rounded" />
                    {SHORT_LABEL[c]}
                  </li>
                ))}
                <li className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                  <CategoryBadge parsed={{ category: 'other', tag: null }} className="size-4 rounded" />
                  Other{tags.length > 0 && <span className="text-ink-subtle">({tags.join(', ')})</span>}
                </li>
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
        </div>
      )}
    </section>
  )
}

function ChipButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 max-w-full items-center gap-1.5 truncate rounded-full border border-line bg-card pr-3 pl-1.5 text-sm text-ink hover:border-line-strong hover:bg-sunken pointer-coarse:h-10',
        focusRing,
      )}
    >
      {children}
    </button>
  )
}

/** "Other…": type what it was (saved as a quick pick), reuse a saved name, or keep it plain Other. */
function OtherNamer({
  tags,
  onPick,
  onForget,
  onBack,
}: {
  tags: readonly string[]
  onPick: (name: string) => void
  onForget: (tag: string) => void
  onBack: () => void
}) {
  const [text, setText] = useState('')
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const clean = cleanTag(text)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onPick(clean)
  }

  return (
    <div className="mt-2">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          What was it?
        </label>
        <input
          id={inputId}
          ref={inputRef}
          value={text}
          maxLength={MAX_TAG_LENGTH}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              onBack()
            }
          }}
          placeholder="e.g. Gym, Travel, Family"
          enterKeyHint="done"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
        />
        <Button type="submit" size="sm" className="h-10">
          {clean ? (
            <>
              <Plus aria-hidden />
              Save
            </>
          ) : (
            'Just Other'
          )}
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-ink-subtle">New names are saved as quick picks for next time.</p>
      {tags.length > 0 && (
        <ul aria-label="Saved names" className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t} className="inline-flex items-center rounded-full border border-line bg-card">
              <button type="button" onClick={() => onPick(t)} className={cn('inline-flex h-8 items-center rounded-l-full pr-2 pl-3 text-sm text-ink hover:bg-sunken pointer-coarse:h-9', focusRing)}>
                {t}
              </button>
              <button
                type="button"
                onClick={() => onForget(t)}
                aria-label={`Forget "${t}"`}
                title="Remove from quick picks (logged hours keep it)"
                className={cn('grid h-8 w-7 place-items-center rounded-r-full text-ink-subtle hover:bg-sunken hover:text-ink pointer-coarse:h-9', focusRing)}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
