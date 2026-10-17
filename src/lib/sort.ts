import type { Dump } from '@/domain/dump'

export type SortMode = 'custom' | 'newest' | 'oldest' | 'az' | 'za' | 'shortest' | 'longest'

export const SORT_OPTIONS: ReadonlyArray<{ value: SortMode; label: string }> = [
  { value: 'custom', label: 'My order' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first (most pending)' },
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'shortest', label: 'Shortest first' },
  { value: 'longest', label: 'Longest first' },
]

export const DEFAULT_SORT: SortMode = 'custom'

export function isSortMode(value: unknown): value is SortMode {
  return SORT_OPTIONS.some((o) => o.value === value)
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

const time = (iso: string) => Date.parse(iso)

/** The one "My order" comparator — store, board and drag logic must all agree on tie-breaks. */
export const byPosition = (a: Dump, b: Dump): number =>
  a.position - b.position || time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const text = (d: Dump) => d.content.trim()

const comparators: Record<SortMode, (a: Dump, b: Dump) => number> = {
  custom: byPosition,
  newest: (a, b) => time(b.createdAt) - time(a.createdAt) || byPosition(a, b),
  oldest: (a, b) => time(a.createdAt) - time(b.createdAt) || byPosition(a, b),
  az: (a, b) => collator.compare(text(a), text(b)) || byPosition(a, b),
  za: (a, b) => collator.compare(text(b), text(a)) || byPosition(a, b),
  shortest: (a, b) => text(a).length - text(b).length || byPosition(a, b),
  longest: (a, b) => text(b).length - text(a).length || byPosition(a, b),
}

export function sortDumps(dumps: readonly Dump[], mode: SortMode): Dump[] {
  return [...dumps].sort(comparators[mode])
}

export function matchesQuery(dump: Dump, query: string): boolean {
  const q = query.trim().toLocaleLowerCase()
  return q === '' || dump.content.toLocaleLowerCase().includes(q)
}
