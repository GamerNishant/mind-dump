import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { focusRing } from './ui'

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = [1, 2, 3, 4, 5]

/** Monday-first display; values are Date#getDay numbers (0 = Sunday). */
export const DAY_TOGGLES = [
  { value: 1, short: 'M', long: 'Monday' },
  { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' },
  { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' },
  { value: 6, short: 'S', long: 'Saturday' },
  { value: 0, short: 'S', long: 'Sunday' },
]

export const sortedDays = (days: readonly number[] | null | undefined) => [...new Set(days ?? [])].sort((a, b) => a - b)
export const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((d, i) => d === b[i])

export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-xl bg-sunken p-1">
      {children}
    </div>
  )
}

export function SegmentButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'h-9 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition sm:h-8',
        pressed ? 'bg-card text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-muted hover:text-ink',
        focusRing,
      )}
    >
      {children}
    </button>
  )
}

/** Seven round M…S toggles. */
export function DayToggles({ days, onChange, label = 'Days' }: { days: readonly number[]; onChange: (days: number[]) => void; label?: string }) {
  const toggle = (day: number) => onChange(sortedDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]))
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {DAY_TOGGLES.map((d) => {
        const on = days.includes(d.value)
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={on}
            aria-label={d.long}
            title={d.long}
            onClick={() => toggle(d.value)}
            className={cn(
              'grid size-9 place-items-center rounded-full text-sm font-medium transition',
              on ? 'bg-accent-solid text-accent-ink shadow-sm' : 'border border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink',
              focusRing,
            )}
          >
            {d.short}
          </button>
        )
      })}
    </div>
  )
}
