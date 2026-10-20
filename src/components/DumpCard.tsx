import type { KeyboardEventHandler, MouseEventHandler, Ref, TouchEventHandler } from 'react'
import type { DraggableAttributes } from '@dnd-kit/core'
import { Bookmark, CalendarCheck, CalendarPlus, Clock, GripVertical, Pencil, Repeat, Sun } from 'lucide-react'
import type { Dump } from '@/domain/dump'
import type { Priority } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { ageTone, daysBetween, formatDate, pendingLabel, type AgeTone } from '@/lib/days'
import { preview } from '@/lib/text'
import { PriorityChip } from './PriorityFlag'

const toneBadge: Record<AgeTone, string> = {
  fresh: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
  warm: 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  hot: 'bg-orange-500/15 text-orange-800 dark:bg-orange-400/10 dark:text-orange-300',
  stale: 'bg-rose-500/15 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
}

const toneBar: Record<AgeTone, string> = {
  fresh: 'bg-emerald-400',
  warm: 'bg-amber-400',
  hot: 'bg-orange-500',
  stale: 'bg-rose-500',
}

export function PendingBadge({ createdAt, now }: { createdAt: string; now: Date }) {
  const days = daysBetween(createdAt, now)
  return (
    <span
      title={`Pending since ${formatDate(createdAt, now)}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        toneBadge[ageTone(days)],
      )}
    >
      <Clock className="size-3" aria-hidden />
      <span className="sr-only">Pending: </span>
      {pendingLabel(days)}
    </span>
  )
}

export interface DragHandleProps {
  ref: Ref<HTMLButtonElement>
  attributes: DraggableAttributes
  onKeyDown?: KeyboardEventHandler
}

export interface DragSurfaceProps {
  onMouseDown?: MouseEventHandler
  onTouchStart?: TouchEventHandler
}

interface DumpCardProps {
  dump: Dump
  now: Date
  /** Rendered inside the DragOverlay (the "lifted" copy). */
  overlay?: boolean
  /** The in-grid slot while its overlay copy is being dragged. */
  placeholder?: boolean
  exiting?: boolean
  surface?: DragSurfaceProps
  handle?: DragHandleProps
  onComplete?: () => void
  onEdit?: () => void
  /** Tile already has an open/done item in Today: shows the "In Today" chip. */
  inToday?: boolean
  /** Short repeat summary ("Daily", "Mon Wed Fri"); shown as a chip when set. */
  repeatLabel?: string
  /** Full repeat description for the chip's tooltip / screen readers. */
  repeatTitle?: string
  /** The Bookmark (resume note); shown as a chip when non-empty. */
  bookmark?: string
  /** Shown as a flag chip when set. */
  priority?: Priority
  /** "+ Today" button. Omit to hide it (e.g. in the drag overlay). */
  onAddToday?: () => void
}

const chip = 'inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium'

const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

export function DumpCard({
  dump,
  now,
  overlay,
  placeholder,
  exiting,
  surface,
  handle,
  onComplete,
  onEdit,
  inToday = false,
  repeatLabel,
  repeatTitle,
  bookmark,
  priority,
  onAddToday,
}: DumpCardProps) {
  const tone = ageTone(daysBetween(dump.createdAt, now))
  const note = bookmark?.trim() ?? ''

  return (
    <div
      {...surface}
      className={cn(
        'tile-touch group relative flex h-full min-h-[7.5rem] flex-col overflow-hidden rounded-2xl border bg-card p-3.5 pl-4 sm:min-h-[8.5rem] sm:p-4 sm:pl-5',
        'shadow-[0_1px_2px_rgb(0_0_0/0.04),0_1px_1px_rgb(0_0_0/0.02)] transition-[box-shadow,border-color,translate,opacity] duration-200',
        overlay
          ? 'cursor-grabbing border-accent/40 shadow-2xl ring-2 ring-accent/30 rotate-[1.5deg]'
          : priority === 'high'
            ? 'border-rose-400/50 hover:-translate-y-0.5 hover:border-rose-400/80 hover:shadow-lg hover:shadow-black/5 dark:border-rose-400/35 dark:hover:shadow-black/30'
            : 'border-line hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/30',
        !overlay && (surface ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'),
        !overlay && !placeholder && !exiting && 'animate-tile-in',
        placeholder && 'border-dashed opacity-35 shadow-none',
        exiting && 'animate-tile-out pointer-events-none',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-3 left-0 w-[3px] rounded-r-full', toneBar[tone])} />

      {onComplete && (
        <button
          type="button"
          onClick={onComplete}
          aria-label={`Mark done: ${preview(dump.content, 120)}`}
          className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        />
      )}

      <p className="pointer-events-none relative line-clamp-6 pr-6 text-[15px] leading-snug break-words whitespace-pre-wrap text-ink">
        {dump.content}
      </p>

      <div
        className={cn(
          'pointer-events-none relative mt-auto flex min-w-0 flex-wrap items-center gap-1 pt-3',
          onAddToday ? 'pr-[4.5rem]' : 'pr-8',
        )}
      >
        {priority && <PriorityChip priority={priority} />}
        <PendingBadge createdAt={dump.createdAt} now={now} />
        {inToday && (
          <span className={cn(chip, 'bg-accent-soft text-accent')}>
            <Sun className="size-3 shrink-0" aria-hidden />
            In Today
          </span>
        )}
        {repeatLabel && (
          <span className={cn(chip, 'bg-sunken text-ink-muted')} title={repeatTitle ?? repeatLabel}>
            <Repeat className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">Repeats: </span>
            <span className="truncate">{repeatLabel}</span>
          </span>
        )}
        {note && (
          // Hoverable so the note shows as a tooltip; it's tiny, so it barely shrinks the click-to-clear area.
          <span className={cn(chip, 'pointer-events-auto cursor-help bg-sunken text-ink-muted')} title={`Bookmark: ${note}`}>
            <Bookmark className="size-3 shrink-0" aria-hidden />
            <span className="sr-only">Bookmark: {note}</span>
          </span>
        )}
      </div>

      {handle && (
        <button
          type="button"
          ref={handle.ref}
          {...handle.attributes}
          onKeyDown={handle.onKeyDown}
          aria-label={`Reorder: ${preview(dump.content, 60)}`}
          className={cn(
            'absolute top-1.5 right-1.5 z-10 grid size-8 place-items-center rounded-lg text-ink-subtle transition',
            'opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            // Touch drags by long-pressing the tile; the handle stays reachable for keyboard/switch users.
            'pointer-coarse:pointer-events-none pointer-coarse:focus-visible:pointer-events-auto',
          )}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      )}

      {onAddToday && (
        <button
          type="button"
          onClick={onAddToday}
          onMouseDown={stop}
          onTouchStart={stop}
          aria-label={`Add to Today: ${preview(dump.content, 60)}`}
          aria-disabled={inToday || undefined}
          title={inToday ? 'Already in Today' : 'Add to Today'}
          className={cn(
            'absolute right-10 bottom-1.5 z-10 grid size-8 place-items-center rounded-lg transition',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'pointer-coarse:opacity-70',
            inToday ? 'cursor-default text-accent' : 'text-ink-subtle hover:bg-accent-soft hover:text-accent',
          )}
        >
          {inToday ? <CalendarCheck className="size-3.5" aria-hidden /> : <CalendarPlus className="size-3.5" aria-hidden />}
        </button>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          onMouseDown={stop}
          onTouchStart={stop}
          aria-label={`Edit: ${preview(dump.content, 60)}`}
          className={cn(
            'absolute right-1.5 bottom-1.5 z-10 grid size-8 place-items-center rounded-lg text-ink-subtle transition',
            'opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            'pointer-coarse:opacity-70',
          )}
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
