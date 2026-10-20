import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, ChevronDown, GripVertical, Pencil, Play, Repeat, RotateCcw, SkipForward } from 'lucide-react'
import { toast } from 'sonner'
import { celebrate } from '@/components/celebrate'
import { Button, focusRing } from '@/components/ui'
import { BLOCK_MINUTES, CARRY_WARN, SKIP_REASON_LABEL, PRIORITY_LABEL, type Priority, type TodayItem } from '@/domain/plan'
import { PRIORITY_CHIP, PriorityFlag } from '@/components/PriorityFlag'
import { cn } from '@/lib/cn'
import { hasRoomFor, type Doc } from '@/lib/plan'
import { preview } from '@/lib/text'
import { useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'

type Item = Doc<TodayItem>

/** Queue rows only move up and down. */
const restrictToVerticalAxisModifier: Modifier = ({ transform }) => ({ ...transform, x: 0 })

// ---- shared actions ----------------------------------------------------------------

/** Start / Done / type changes, shared by the Next card and the queue rows. */
function useItemActions(view: TodayView) {
  const planner = usePlanner()
  const dumps = useDumpsStore()
  const navigate = useNavigate()

  const undo = (item: Item) => ({ label: 'Undo', onClick: () => void planner.reopen(item.id) })

  /** A small burst for each finish; a big one (and a cheer) when the queue is clear. */
  const cheer = (item: Item) => {
    const left = view.items.filter((i) => i.data.status === 'open' && i.id !== item.id).length
    celebrate(null, left === 0 ? 'big' : 'small')
    if (left === 0) toast.success('Queue clear! Everything planned is handled.', { description: 'Take a breath. You earned it.' })
  }

  return {
    async start(item: Item) {
      if (view.focus) {
        if (view.focus.data.itemId !== item.id) toast('A block is already running', { description: 'Finish it first, then start the next.' })
        navigate('/focus')
        return
      }
      const id = await planner.startFocus(item.id, 'full')
      if (id) navigate('/focus')
    },

    async completeTask(item: Item) {
      if (!(await planner.complete(item.id))) return
      cheer(item)
      const { dumpId, routine } = item.data
      // A recurring tile stays on the board by design, so only offer to clear one-off tiles.
      if (dumpId && !routine) {
        toast.success('Done', {
          description: preview(item.data.title),
          action: {
            label: 'Also clear the tile',
            onClick: () => void dumps.complete(dumpId).then((d) => d && toast.success('Tile cleared')),
          },
          cancel: undo(item),
        })
      } else {
        toast.success('Done', { description: preview(item.data.title), action: undo(item) })
      }
    },

    async completeBlock(item: Item, minMet: boolean) {
      if (!minMet) {
        toast('Not done. It stays in the queue.', { description: 'Start it again at its minimum, or Skip it with a reason.' })
        return
      }
      if (!(await planner.complete(item.id, true))) return
      cheer(item)
      toast.success('Block done', { description: preview(item.data.title), action: undo(item) })
    },

    async setType(item: Item, type: TodayItem['type']) {
      if (item.data.type === type) return
      const others = view.items.filter((i) => i.id !== item.id)
      if (type === 'block' && !item.data.habit && !hasRoomFor('block', others, view.settings)) {
        toast(`Today is full — the block cap is ${view.settings.blockCap}`)
        return
      }
      await planner.updateItem(item.id, { type })
    },

    setMinutes(item: Item, minutes: number) {
      if (item.data.minutes !== minutes) void planner.updateItem(item.id, { minutes })
    },

    setField(item: Item, field: 'firstAction' | 'minimum', value: string) {
      void planner.updateItem(item.id, { [field]: value })
    },

    async reopen(item: Item) {
      // Skipped items don't hold a slot; bringing one back must respect the cap.
      if (item.data.status === 'skipped' && !item.data.habit && !hasRoomFor(item.data.type, view.items, view.settings)) {
        toast('Today is full: finish, skip or remove one first')
        return
      }
      if (await planner.reopen(item.id)) toast('Back in the queue', { description: preview(item.data.title) })
    },
  }
}

// ---- small pieces ------------------------------------------------------------------

const chip =
  'inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap pointer-coarse:h-9 [&_svg]:size-3.5'

const amberChip = 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300'

/** Click to edit; Enter or blur saves, Escape cancels. */
export function InlineField({
  label,
  value,
  placeholder,
  onSave,
  large,
  className,
}: {
  label: string
  value: string
  placeholder: string
  onSave: (value: string) => void
  large?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const cancelled = useRef(false)
  const viaKey = useRef(false)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const finish = () => {
    setEditing(false)
    const next = draft.trim()
    if (!cancelled.current && next !== value.trim()) onSave(next)
    cancelled.current = false
    // Return focus only when the edit ended from the keyboard; a click elsewhere keeps its target.
    if (viaKey.current) requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }))
    viaKey.current = false
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={140}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            viaKey.current = true
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancelled.current = true
            viaKey.current = true
            e.currentTarget.blur()
          }
        }}
        className={cn(
          'w-full min-w-0 rounded-lg border border-accent bg-card px-2.5 text-base text-ink shadow-xs focus:outline-none focus:ring-4 focus:ring-accent/15',
          large ? 'h-12 sm:text-lg' : 'h-10 sm:text-sm',
          className,
        )}
      />
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      aria-label={value ? `${label}: ${value}. Edit` : `Add ${label.toLowerCase()}`}
      className={cn(
        'block max-w-full min-w-0 rounded-lg px-1.5 py-1 text-left break-words transition hover:bg-sunken',
        focusRing,
        large ? 'min-h-11 text-lg leading-snug sm:text-xl' : 'min-h-8 text-sm',
        value ? 'text-ink' : 'text-ink-subtle',
        className,
      )}
    >
      {value ? (
        large ? (
          value
        ) : (
          <>
            <span className="text-ink-subtle">{label}: </span>
            {value}
          </>
        )
      ) : (
        `+ ${label}`
      )}
    </button>
  )
}

function CarryChip({ item }: { item: Item }) {
  const { carryCount, dumpId } = item.data
  if (carryCount < 1) return null
  const warn = carryCount >= CARRY_WARN
  return (
    <>
      <span className={cn(chip, warn ? amberChip : 'bg-sunken text-ink-muted')} title={item.data.carriedFrom ? `Carried from ${item.data.carriedFrom}` : undefined}>
        Carried ×{carryCount}
      </span>
      {warn && dumpId && (
        <Link
          to="/"
          state={{ editDumpId: dumpId }}
          className={cn(chip, 'text-amber-800 underline decoration-amber-500/50 underline-offset-2 hover:decoration-amber-600 dark:text-amber-300', focusRing)}
        >
          Too big? Split it
        </Link>
      )}
    </>
  )
}

function TagChips({ item, priority }: { item: Item; priority?: Priority | null }) {
  return (
    <>
      {priority && (
        <span className={cn(chip, PRIORITY_CHIP[priority])} title={`${PRIORITY_LABEL[priority]} priority`}>
          <PriorityFlag priority={priority} />
          {PRIORITY_LABEL[priority]}
          <span className="sr-only"> priority</span>
        </span>
      )}
      {item.data.routine && (
        <span className={cn(chip, 'bg-sunken text-ink-muted')}>
          <Repeat aria-hidden />
          Routine
        </span>
      )}
      {item.data.habit && <span className={cn(chip, 'bg-sunken text-ink-muted')} title="Doesn't count toward the cap">Light</span>}
      <CarryChip item={item} />
    </>
  )
}

function TypeToggle({ item, onChange }: { item: Item; onChange: (type: TodayItem['type']) => void }) {
  const isBlock = item.data.type === 'block'
  return (
    <button
      type="button"
      onClick={() => onChange(isBlock ? 'task' : 'block')}
      aria-label={`Type: ${isBlock ? 'Block' : 'Task'}. Switch to ${isBlock ? 'Task' : 'Block'}`}
      title={`Switch to ${isBlock ? 'Task' : 'Block'}`}
      className={cn(chip, 'border transition', focusRing, isBlock ? 'border-accent/30 bg-accent-soft text-accent' : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink')}
    >
      {isBlock ? 'Block' : 'Task'}
    </button>
  )
}

function MinutesPicker({ item, onChange }: { item: Item; onChange: (minutes: number) => void }) {
  const options: number[] = [...BLOCK_MINUTES]
  if (!options.includes(item.data.minutes)) options.unshift(item.data.minutes)
  return (
    <div role="group" aria-label="Block length" className="inline-flex rounded-lg border border-line bg-card p-0.5">
      {options.map((m) => {
        const active = m === item.data.minutes
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            aria-label={`${m} minutes`}
            onClick={() => onChange(m)}
            className={cn(
              'h-7 min-w-9 rounded-md px-1.5 text-xs font-medium tabular-nums transition pointer-coarse:h-8',
              focusRing,
              active ? 'bg-accent-solid text-accent-ink' : 'text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {m}
            <span aria-hidden>m</span>
          </button>
        )
      })}
    </div>
  )
}

function MinMetPrompt({ onAnswer, onCancel }: { onAnswer: (met: boolean) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => ref.current?.querySelector('button')?.focus(), [])
  return (
    <div
      ref={ref}
      role="group"
      aria-labelledby={id}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      className="animate-fade-up mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-sunken px-3 py-2"
    >
      <span id={id} className="text-sm font-medium text-ink">
        Minimum met?
      </span>
      <Button size="sm" onClick={() => onAnswer(true)}>
        Yes
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onAnswer(false)}>
        No
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel} className="ml-auto">
        Cancel
      </Button>
    </div>
  )
}

// ---- Next card ---------------------------------------------------------------------------

/** The first open item, shown large. Blocks: Start; tasks: Done. Both: Skip. */
export function NextCard({ view, onSkip, onEdit }: { view: TodayView; onSkip: (item: Item) => void; onEdit: (item: Item) => void }) {
  const actions = useItemActions(view)
  const item = view.next
  if (!item) return null
  const { data } = item
  const isBlock = data.type === 'block'
  const running = view.focus?.data.itemId === item.id

  return (
    <section aria-labelledby="next-heading" className="animate-fade-up rounded-3xl border border-accent/25 bg-card bg-linear-to-br from-accent-soft/70 via-card to-card p-5 shadow-md shadow-accent/10 sm:p-6">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 id="next-heading" className="mr-1 text-xs font-semibold tracking-wide text-accent uppercase">
          Next
        </h2>
        <span className={cn(chip, isBlock ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted')}>
          {isBlock ? `Block · ${data.minutes} min` : 'Task'}
        </span>
        <TagChips item={item} priority={item.data.dumpId ? view.metas.get(item.data.dumpId)?.priority : null} />
        <Button variant="ghost" size="icon-sm" className="ml-auto pointer-coarse:size-10" onClick={() => onEdit(item)} aria-label={`Edit: ${preview(data.title, 60)}`} title="Edit, set priority or remove">
          <Pencil aria-hidden />
        </Button>
      </div>

      <p className="mt-3 text-xl leading-snug font-semibold tracking-tight break-words text-ink sm:text-2xl">{data.title}</p>

      <div className="mt-4">
        <p className="px-1.5 text-xs font-medium text-ink-subtle">First action</p>
        <InlineField
          large
          label="First action"
          value={data.firstAction}
          placeholder="Pen in hand, open p.14"
          onSave={(v) => actions.setField(item, 'firstAction', v)}
        />
      </div>
      <div className="mt-1">
        <InlineField label="Minimum" value={data.minimum} placeholder="5 bullet notes" onSave={(v) => actions.setField(item, 'minimum', v)} />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {isBlock ? (
          <Button size="lg" onClick={() => void actions.start(item)} className="min-w-32 flex-1 sm:flex-none">
            <Play aria-hidden />
            {running ? 'Open block' : 'Start'}
          </Button>
        ) : (
          <Button size="lg" onClick={() => void actions.completeTask(item)} className="min-w-32 flex-1 sm:flex-none">
            <Check aria-hidden />
            Done
          </Button>
        )}
        {!running && (
          <Button size="lg" variant="secondary" onClick={() => onSkip(item)}>
            <SkipForward aria-hidden />
            Skip
          </Button>
        )}
      </div>
    </section>
  )
}

// ---- Queue -----------------------------------------------------------------------------------

export function QueueList({ view, onSkip, onEdit }: { view: TodayView; onSkip: (item: Item) => void; onEdit: (item: Item) => void }) {
  const planner = usePlanner()
  const actions = useItemActions(view)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)

  const open = useMemo(() => view.items.filter((i) => i.data.status === 'open'), [view.items])
  const closed = useMemo(() => view.items.filter((i) => i.data.status !== 'open'), [view.items])
  const ids = useMemo(() => open.map((i) => i.id), [open])
  const byId = useMemo(() => new Map(open.map((i) => [i.id, i])), [open])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press the grip on touch so normal swipes still scroll the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const describe = (id: UniqueIdentifier) => `"${preview(byId.get(String(id))?.data.title ?? 'item', 40)}"`
  const position = (id: UniqueIdentifier) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active.id)} at ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${describe(active.id)} moved to ${position(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${describe(active.id)} at ${position(over.id)}.` : `Dropped ${describe(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${describe(active.id)} returned to its place.`,
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    void planner.reorder(view.today, String(active.id), arrayMove(ids, from, to))
  }

  return (
    <section aria-labelledby="queue-heading">
      <div className="flex items-baseline gap-2">
        <h2 id="queue-heading" className="text-base font-semibold tracking-tight">
          Queue
        </h2>
        <span className="text-xs text-ink-subtle tabular-nums">
          {open.length} open
          {open.length > 1 && (
            <span className="max-sm:hidden"> · drag the grip to reorder</span>
          )}
        </span>
      </div>

      {open.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-ink-muted">
          Queue clear. Nothing open.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxisModifier]}
          onDragEnd={handleDragEnd}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To reorder, press Space or Enter to pick up this item, use the arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.',
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol aria-label="Today's queue" className="mt-3 flex flex-col gap-2">
              {open.map((item, index) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  priority={item.data.dumpId ? view.metas.get(item.data.dumpId)?.priority : null}
                  isNext={index === 0}
                  running={view.focus?.data.itemId === item.id}
                  confirming={confirmingId === item.id}
                  actions={actions}
                  onDone={() => {
                    if (item.data.type === 'block') setConfirmingId(item.id)
                    else void actions.completeTask(item)
                  }}
                  onAnswer={(met) => {
                    setConfirmingId(null)
                    void actions.completeBlock(item, met)
                  }}
                  onCancelConfirm={() => setConfirmingId(null)}
                  onSkip={() => onSkip(item)}
                  onEdit={() => onEdit(item)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      {closed.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            aria-expanded={closedOpen}
            aria-controls="closed-items"
            onClick={() => setClosedOpen((v) => !v)}
            className={cn('flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-ink-muted hover:text-ink', focusRing)}
          >
            <ChevronDown className={cn('size-4 transition-transform', closedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden />
            Done &amp; skipped ({closed.length})
          </button>
          {closedOpen && (
            <ul id="closed-items" className="mt-1 flex flex-col gap-1">
              {closed.map((item) => (
                <ClosedRow key={item.id} item={item} onReopen={() => void actions.reopen(item)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

type Actions = ReturnType<typeof useItemActions>

interface QueueRowProps {
  item: Item
  priority?: Priority | null
  isNext: boolean
  running: boolean
  confirming: boolean
  actions: Actions
  onDone: () => void
  onAnswer: (met: boolean) => void
  onCancelConfirm: () => void
  onSkip: () => void
  onEdit: () => void
}

function QueueRow({ item, priority, isNext, running, confirming, actions, onDone, onAnswer, onCancelConfirm, onSkip, onEdit }: QueueRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const { data } = item
  const isBlock = data.type === 'block'
  const title = preview(data.title, 80)
  const doneRef = useRef<HTMLButtonElement>(null)

  // When the Minimum-met prompt closes without completing the row, hand focus back to its Done button.
  const refocusDone = () => requestAnimationFrame(() => doneRef.current?.focus({ preventScroll: true }))
  const answer = (met: boolean) => {
    onAnswer(met)
    if (!met) refocusDone()
  }
  const cancelConfirm = () => {
    onCancelConfirm()
    refocusDone()
  }

  return (
    <li
      ref={setNodeRef}
      data-item-id={item.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'relative rounded-2xl border bg-card transition-[box-shadow,border-color]',
        isDragging ? 'z-10 border-accent/40 shadow-xl ring-2 ring-accent/25' : 'border-line',
        running && 'border-accent/40',
      )}
    >
      <div className="flex items-start gap-0.5 py-1.5 pr-2 pl-0.5 sm:pr-3">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder: ${title}`}
          className={cn(
            'tile-touch grid h-11 w-7 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-subtle hover:bg-sunken hover:text-ink active:cursor-grabbing',
            focusRing,
          )}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        <button
          ref={doneRef}
          type="button"
          onClick={onDone}
          aria-label={`Done: ${title}`}
          aria-expanded={isBlock ? confirming : undefined}
          className={cn('group grid size-11 shrink-0 place-items-center rounded-full', focusRing)}
        >
          <span className="grid size-6 place-items-center rounded-full border-2 border-line-strong text-transparent transition group-hover:border-accent group-hover:text-accent">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
        </button>

        <div className="min-w-0 flex-1 py-1.5">
          <button
            type="button"
            onClick={onEdit}
            className={cn('-mx-1 block max-w-full rounded-md px-1 text-left hover:bg-sunken', focusRing)}
            aria-label={`Edit: ${title}`}
          >
            <span className="line-clamp-2 text-[15px] leading-snug break-words text-ink">
              {isNext && <span className="sr-only">Next: </span>}
              {data.title}
            </span>
          </button>

          <div className="mt-1 flex flex-wrap gap-x-1 gap-y-0">
            <InlineField label="First action" value={data.firstAction} placeholder="One physical first step" onSave={(v) => actions.setField(item, 'firstAction', v)} />
            <InlineField label="Minimum" value={data.minimum} placeholder="Output floor for a bad day" onSave={(v) => actions.setField(item, 'minimum', v)} />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TypeToggle item={item} onChange={(type) => void actions.setType(item, type)} />
            {isBlock && <MinutesPicker item={item} onChange={(m) => actions.setMinutes(item, m)} />}
            <TagChips item={item} priority={priority} />
            <div className="ml-auto flex items-center gap-1">
              {isBlock && (
                <Button size="sm" variant={isNext ? 'primary' : 'secondary'} onClick={() => void actions.start(item)} className="pointer-coarse:h-10">
                  <Play aria-hidden />
                  {running ? 'Open' : 'Start'}
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={`Edit or remove: ${title}`} title="Edit, set priority or remove" className="pointer-coarse:size-10">
                <Pencil aria-hidden />
              </Button>
              {!running && (
                <Button size="sm" variant="ghost" onClick={onSkip} aria-label={`Skip: ${title}`} className="pointer-coarse:h-10">
                  <SkipForward aria-hidden />
                  Skip
                </Button>
              )}
            </div>
          </div>

          {confirming && <MinMetPrompt onAnswer={answer} onCancel={cancelConfirm} />}
        </div>
      </div>
    </li>
  )
}

function ClosedRow({ item, onReopen }: { item: Item; onReopen: () => void }) {
  const { data } = item
  const done = data.status === 'done'
  const reason = data.skips.at(-1)?.reason
  const title = preview(data.title, 80)
  return (
    <li className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-1 hover:bg-sunken/60">
      {done ? (
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-solid text-accent-ink">
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      ) : (
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-ink-subtle">
          <SkipForward className="size-3.5" aria-hidden />
        </span>
      )}
      <span className="sr-only">{done ? 'Done:' : 'Skipped:'}</span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', done ? 'text-ink-muted line-through decoration-ink-subtle' : 'text-ink-muted')}>{data.title}</span>
      {done && data.type === 'block' && !data.minMet && <span className={cn(chip, 'bg-sunken text-ink-subtle')}>Min not met</span>}
      {!done && reason && <span className={cn(chip, 'bg-sunken text-ink-muted')}>{SKIP_REASON_LABEL[reason]}</span>}
      <Button size="sm" variant="ghost" onClick={onReopen} aria-label={`${done ? 'Undo done' : 'Reopen'}: ${title}`} className="pointer-coarse:h-10">
        <RotateCcw aria-hidden />
        <span className="max-[400px]:sr-only">{done ? 'Undo' : 'Reopen'}</span>
      </Button>
    </li>
  )
}
