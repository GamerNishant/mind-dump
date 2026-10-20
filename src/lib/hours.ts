import { HOUR_CATEGORIES, HOUR_CATEGORY_LABEL, MAX_TAG_LENGTH, type HourCategory, type HourLog, type HourValue } from '@/domain/plan'
import { addDays, hourLogOf, weekdayOf, type Docs } from './plan'

/**
 * Hour-log values and summaries. A logged hour is a category ("study") or a named Other hour
 * ("other:Gym"). Named Other hours roll up under Other in every summary, with their names kept
 * as a breakdown, so the chart never needs more colours than there are categories.
 */

export interface ParsedHour {
  category: HourCategory
  /** The name given to an Other hour, if any. */
  tag: string | null
}

const OTHER_PREFIX = 'other:'

/** Trim, collapse spaces and cap the length of a user-typed tag. */
export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH)
}

export function parseHour(value: string | undefined | null): ParsedHour | null {
  if (!value) return null
  if (value.startsWith(OTHER_PREFIX)) {
    const tag = cleanTag(value.slice(OTHER_PREFIX.length))
    return { category: 'other', tag: tag || null }
  }
  if ((HOUR_CATEGORIES as readonly string[]).includes(value)) return { category: value as HourCategory, tag: null }
  // Written by another version, or hand-edited: it still counts, as Other.
  return { category: 'other', tag: null }
}

/**
 * The value to store for a pick. A tag that matches a built-in category's name ("study",
 * "Sleep") becomes that category instead of a duplicate Other.
 */
export function hourValue(category: HourCategory, tag?: string | null): HourValue {
  if (category !== 'other') return category
  const clean = cleanTag(tag ?? '')
  if (!clean) return 'other'
  const lower = clean.toLowerCase()
  const builtin = HOUR_CATEGORIES.find((c) => c !== 'other' && (c === lower || HOUR_CATEGORY_LABEL[c].toLowerCase() === lower))
  return builtin ?? `other:${clean}`
}

/** "Gym" for a named Other hour, else the category's label. */
export function hourLabel(parsed: ParsedHour, labels: Record<HourCategory, string> = HOUR_CATEGORY_LABEL): string {
  return parsed.tag ?? labels[parsed.category]
}

/** Case-insensitive de-duplicated tag list, keeping the first spelling and order. */
export function mergeTags(existing: readonly string[], added: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...existing, ...added]) {
    const tag = cleanTag(raw)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

export interface CategoryTotal {
  category: HourCategory
  hours: number
  /** Named Other hours, largest first (only for `other`). */
  tags: Array<{ tag: string; hours: number }>
}

/** Totals per category, largest first. */
export function summarize(logs: ReadonlyArray<HourLog>): CategoryTotal[] {
  const totals = new Map<HourCategory, { hours: number; tags: Map<string, number> }>()
  for (const log of logs) {
    for (const value of Object.values(log.hours)) {
      const parsed = parseHour(value)
      if (!parsed) continue
      const entry = totals.get(parsed.category) ?? { hours: 0, tags: new Map<string, number>() }
      entry.hours++
      if (parsed.tag) entry.tags.set(parsed.tag, (entry.tags.get(parsed.tag) ?? 0) + 1)
      totals.set(parsed.category, entry)
    }
  }
  return [...totals]
    .map(([category, { hours, tags }]) => ({
      category,
      hours,
      tags: [...tags].map(([tag, h]) => ({ tag, hours: h })).sort((a, b) => b.hours - a.hours || a.tag.localeCompare(b.tag)),
    }))
    .sort((a, b) => b.hours - a.hours || HOUR_CATEGORIES.indexOf(a.category) - HOUR_CATEGORIES.indexOf(b.category))
}

/** The Monday-to-Sunday week containing `day`, shifted by `offset` weeks (−1 = last week). */
export function weekOf(day: string, offset = 0): string[] {
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7) + offset * 7)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export interface WeekSummary {
  days: Array<{ day: string; total: number; segments: CategoryTotal[] }>
  totals: CategoryTotal[]
  /** Hours logged in the whole week. */
  logged: number
  /** Days with at least one logged hour. */
  activeDays: number
}

export function weekSummary(docs: Docs, days: readonly string[]): WeekSummary {
  const logs = days.map((day) => hourLogOf(docs, day))
  const perDay = days.map((day, i) => {
    // Stack in one fixed order so a category sits in the same place every day.
    const segments = summarize([logs[i]]).sort((a, b) => HOUR_CATEGORIES.indexOf(a.category) - HOUR_CATEGORIES.indexOf(b.category))
    return { day, total: segments.reduce((n, s) => n + s.hours, 0), segments }
  })
  const totals = summarize(logs)
  return {
    days: perDay,
    totals,
    logged: totals.reduce((n, t) => n + t.hours, 0),
    activeDays: perDay.filter((d) => d.total > 0).length,
  }
}

/** Whole-number share, e.g. 33 for 1 of 3. 0 when there is nothing logged. */
export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
