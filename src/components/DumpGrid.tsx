import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEventHandler, type MouseEventHandler, type TouchEventHandler } from 'react'
import { createPortal } from 'react-dom'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Dump } from '@/domain/dump'
import type { RepeatDays, TileMeta } from '@/domain/plan'
import { preview } from '@/lib/text'
import { DumpCard } from './DumpCard'

interface DumpGridProps {
  dumps: Dump[]
  now: Date
  dragDisabled: boolean
  exitingIds: ReadonlySet<string>
  onComplete: (dump: Dump) => void
  onEdit: (dump: Dump) => void
  /** `orderedIds` is the full visible order after the move. */
  onReorder: (movedId: string, orderedIds: string[]) => void
  /** Dump ids that are already in Today (shows the "In Today" chip). */
  inTodayIds?: ReadonlySet<string>
  /** Planner info per dump id (repeat days, Bookmark). */
  metas?: ReadonlyMap<string, TileMeta>
  /** Shows the "+ Today" button on every tile when given. */
  onAddToday?: (dump: Dump) => void
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Monday-first display order (values are Date#getDay numbers). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** Short chip label + full description for a repeat setting, or null when it doesn't repeat. */
function describeRepeat(repeat: RepeatDays | null | undefined): { label: string; title: string } | null {
  if (!repeat?.length) return null
  const days = WEEK_ORDER.filter((d) => repeat.includes(d))
  if (days.length === 0) return null
  const key = days.join(',')
  const title = `Repeats ${days.map((d) => DAY_LONG[d]).join(', ')}`
  if (days.length === 7) return { label: 'Daily', title: 'Repeats every day' }
  if (key === '1,2,3,4,5') return { label: 'Weekdays', title: 'Repeats on weekdays' }
  if (key === '6,0') return { label: 'Weekends', title: 'Repeats on weekends' }
  if (days.length <= 3) return { label: days.map((d) => DAY_SHORT[d]).join(' '), title }
  return { label: `${days.length} days`, title }
}

/** Ignore the click that some browsers fire right after a drop. */
const CLICK_AFTER_DRAG_MS = 250

export function DumpGrid({
  dumps,
  now,
  dragDisabled,
  exitingIds,
  onComplete,
  onEdit,
  onReorder,
  inTodayIds,
  metas,
  onAddToday,
}: DumpGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const lastDragEnd = useRef(0)
  // Latest callbacks behind stable wrappers, so memoized tiles don't re-render on every parent render.
  const callbacks = useRef({ onComplete, onEdit, onAddToday })
  useLayoutEffect(() => {
    callbacks.current = { onComplete, onEdit, onAddToday }
  })
  const handleComplete = useCallback((dump: Dump) => {
    if (performance.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS) return
    callbacks.current.onComplete(dump)
  }, [])
  const handleEdit = useCallback((dump: Dump) => callbacks.current.onEdit(dump), [])
  const handleAddToday = useCallback((dump: Dump) => callbacks.current.onAddToday?.(dump), [])
  const canAddToday = !!onAddToday

  /** Primitive per-tile planner props, so memoized tiles only re-render when their own info changes. */
  const infoOf = (id: string) => {
    const meta = metas?.get(id)
    const repeat = describeRepeat(meta?.repeat)
    return {
      inToday: inTodayIds?.has(id) ?? false,
      repeatLabel: repeat?.label,
      repeatTitle: repeat?.title,
      bookmark: meta?.resumeNote?.trim() || undefined,
    }
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch so normal swipes still scroll the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = useMemo(() => dumps.map((d) => d.id), [dumps])
  const byId = useMemo(() => new Map(dumps.map((d) => [d.id, d])), [dumps])
  const activeDump = activeId ? byId.get(activeId) : undefined

  const describe = (id: UniqueIdentifier) => `"${preview(byId.get(String(id))?.content ?? 'dump', 40)}"`
  const position = (id: UniqueIdentifier) => `position ${ids.indexOf(String(id)) + 1} of ${ids.length}`
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${describe(active.id)} at ${position(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${describe(active.id)} moved to ${position(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${describe(active.id)} at ${position(over.id)}.` : `Dropped ${describe(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${describe(active.id)} returned to its place.`,
  }

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    lastDragEnd.current = performance.now()
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(String(active.id), arrayMove(ids, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To reorder, press Space or Enter to pick up this dump, use the arrow keys to move it, then press Space or Enter again to drop it. Press Escape to cancel.',
        },
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={dragDisabled}>
        <ul
          aria-label="Pending dumps"
          className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] sm:gap-4"
        >
          {dumps.map((dump) => (
            <SortableTile
              key={dump.id}
              dump={dump}
              now={now}
              disabled={dragDisabled}
              exiting={exitingIds.has(dump.id)}
              onComplete={handleComplete}
              onEdit={handleEdit}
              onAddToday={canAddToday ? handleAddToday : undefined}
              {...infoOf(dump.id)}
            />
          ))}
        </ul>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {activeDump ? <DumpCard dump={activeDump} now={now} overlay {...infoOf(activeDump.id)} /> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}

interface SortableTileProps {
  dump: Dump
  now: Date
  disabled: boolean
  exiting: boolean
  onComplete: (dump: Dump) => void
  onEdit: (dump: Dump) => void
  onAddToday?: (dump: Dump) => void
  inToday: boolean
  repeatLabel?: string
  repeatTitle?: string
  bookmark?: string
}

const SortableTile = memo(function SortableTile({
  dump,
  now,
  disabled,
  exiting,
  onComplete,
  onEdit,
  onAddToday,
  inToday,
  repeatLabel,
  repeatTitle,
  bookmark,
}: SortableTileProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: dump.id,
    disabled,
  })

  const canDrag = !disabled && !exiting
  return (
    <li
      ref={setNodeRef}
      data-dump-id={dump.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? 'relative z-10' : 'relative'}
    >
      <DumpCard
        dump={dump}
        now={now}
        placeholder={isDragging}
        exiting={exiting}
        surface={
          canDrag
            ? {
                onMouseDown: listeners?.onMouseDown as MouseEventHandler | undefined,
                onTouchStart: listeners?.onTouchStart as TouchEventHandler | undefined,
              }
            : undefined
        }
        handle={
          canDrag
            ? {
                ref: setActivatorNodeRef,
                attributes,
                onKeyDown: listeners?.onKeyDown as KeyboardEventHandler | undefined,
              }
            : undefined
        }
        onComplete={() => onComplete(dump)}
        onEdit={() => onEdit(dump)}
        onAddToday={onAddToday ? () => onAddToday(dump) : undefined}
        inToday={inToday}
        repeatLabel={repeatLabel}
        repeatTitle={repeatTitle}
        bookmark={bookmark}
      />
    </li>
  )
})
