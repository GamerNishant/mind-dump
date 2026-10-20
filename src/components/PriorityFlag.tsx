import { Flag } from 'lucide-react'
import { PRIORITY_LABEL, type Priority } from '@/domain/plan'
import { cn } from '@/lib/cn'

/** Icon colour per priority. Always shown with a word or an accessible label, never colour alone. */
export const PRIORITY_ICON: Record<Priority, string> = {
  high: 'fill-rose-500 text-rose-600 dark:fill-rose-400 dark:text-rose-400',
  medium: 'fill-amber-400 text-amber-600 dark:fill-amber-300 dark:text-amber-300',
  low: 'text-sky-600 dark:text-sky-400',
}

/** Chip background + text per priority (used on tiles and queue rows). */
export const PRIORITY_CHIP: Record<Priority, string> = {
  high: 'bg-rose-500/12 text-rose-800 dark:bg-rose-400/15 dark:text-rose-300',
  medium: 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  low: 'bg-sky-500/10 text-sky-800 dark:bg-sky-400/10 dark:text-sky-300',
}

export function PriorityFlag({ priority, className }: { priority: Priority; className?: string }) {
  return <Flag aria-hidden className={cn('size-3 shrink-0', PRIORITY_ICON[priority], className)} />
}

/** "⚑ High" chip. `compact` hides the word visually (still read by screen readers). */
export function PriorityChip({ priority, className, compact }: { priority: Priority; className?: string; compact?: boolean }) {
  return (
    <span
      title={`${PRIORITY_LABEL[priority]} priority`}
      className={cn('inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_CHIP[priority], className)}
    >
      <PriorityFlag priority={priority} />
      <span className={cn(compact && 'sr-only')}>{PRIORITY_LABEL[priority]}</span>
      <span className="sr-only"> priority</span>
    </span>
  )
}
