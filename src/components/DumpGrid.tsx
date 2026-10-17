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
}

/** Ignore the click that some browsers fire right after a drop. */
const CLICK_AFTER_DRAG_MS = 250

export function DumpGrid({ dumps, now, dragDisabled, exitingIds, onComplete, onEdit, onReorder }: DumpGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const lastDragEnd = useRef(0)
  // Latest callbacks behind stable wrappers, so memoized tiles don't re-render on every parent render.
  const callbacks = useRef({ onComplete, onEdit })
  useLayoutEffect(() => {
    callbacks.current = { onComplete, onEdit }
  })
  const handleComplete = useCallback((dump: Dump) => {
    if (performance.now() - lastDragEnd.current < CLICK_AFTER_DRAG_MS) return
    callbacks.current.onComplete(dump)
  }, [])
  const handleEdit = useCallback((dump: Dump) => callbacks.current.onEdit(dump), [])

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
            />
          ))}
        </ul>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
          {activeDump ? <DumpCard dump={activeDump} now={now} overlay /> : null}
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
}

const SortableTile = memo(function SortableTile({ dump, now, disabled, exiting, onComplete, onEdit }: SortableTileProps) {
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
      />
    </li>
  )
})
