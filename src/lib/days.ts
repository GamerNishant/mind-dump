const DAY_MS = 86_400_000

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole calendar days (local time) between two instants; never negative. */
export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const start = startOfLocalDay(new Date(from))
  const end = startOfLocalDay(new Date(to))
  // Math.round absorbs 23h/25h days around DST changes.
  return Math.max(0, Math.round((end - start) / DAY_MS))
}

export function pendingLabel(days: number): string {
  if (days <= 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

export type AgeTone = 'fresh' | 'warm' | 'hot' | 'stale'

export function ageTone(days: number): AgeTone {
  if (days < 3) return 'fresh'
  if (days < 7) return 'warm'
  if (days < 14) return 'hot'
  return 'stale'
}

export function formatDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Heading for a group of history items: "Today", "Yesterday", or a date. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const diff = daysBetween(iso, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  })
}

export function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
