import { EVERY_DAY, KIND, type Habit } from '@/domain/plan'
import { addDays, docsOfKind, weekdayOf, type Doc, type Docs } from './plan'

/**
 * Habit-stack rules (pure). A habit is due on its weekdays; `done` lists the planner days it was
 * logged. Streaks forgive one thing only: today not being done yet never breaks a streak, since
 * the day isn't over.
 */

export const habitsOf = (docs: Docs): Array<Doc<Habit>> =>
  docsOfKind<Partial<Habit>>(docs, KIND.habit)
    .map((d) => ({ ...d, data: normalizeHabit(d.data) }))
    .sort((a, b) => a.data.order - b.data.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

/** Defaults for missing or malformed fields (older or hand-edited documents). */
export function normalizeHabit(raw: Partial<Habit>): Habit {
  const days = Array.isArray(raw.days) ? [...new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : []
  const done = Array.isArray(raw.done) ? [...new Set(raw.done.filter((d) => typeof d === 'string'))].sort() : []
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Habit',
    days: days.length ? days : [...EVERY_DAY],
    done,
    order: typeof raw.order === 'number' ? raw.order : 0,
    startDay: typeof raw.startDay === 'string' ? raw.startDay : (done[0] ?? '9999-12-31'),
  }
}

export const isDue = (habit: Habit, day: string) => habit.days.includes(weekdayOf(day))

export const isDone = (habit: Habit, day: string) => habit.done.includes(day)

/** `done` with `day` toggled (kept sorted and unique). */
export function toggleDone(habit: Habit, day: string): string[] {
  return isDone(habit, day) ? habit.done.filter((d) => d !== day) : [...habit.done, day].sort()
}

/** First day that counts: the day it was added, or an earlier logged day. */
const firstDay = (habit: Habit) => [habit.startDay, habit.done[0]].filter((d): d is string => !!d).sort()[0]

/**
 * Consecutive due days done, counting back from today. Rest days (not due) are skipped over
 * (done anyway counts as a bonus), and an unfinished today doesn't break it.
 */
export function currentStreak(habit: Habit, today: string): number {
  const done = new Set(habit.done)
  const first = firstDay(habit) ?? today
  let streak = 0
  let day = done.has(today) ? today : addDays(today, -1)
  while (day >= first) {
    if (done.has(day)) streak++
    else if (isDue(habit, day)) break
    day = addDays(day, -1)
  }
  return streak
}

/** Longest run of done days, where rest days in between don't break it. */
export function bestStreak(habit: Habit, today: string): number {
  if (!habit.done.length) return 0
  const done = new Set(habit.done)
  let best = 0
  let run = 0
  for (let day = habit.done[0]; day <= today; day = addDays(day, 1)) {
    if (done.has(day)) run++
    else if (isDue(habit, day) && day !== today) run = 0
    best = Math.max(best, run)
  }
  return best
}

/**
 * Share of due days done over the last `window` days, from the day the habit was added. Today
 * counts only once it is done. Null when no due day has counted yet.
 */
export function consistency(habit: Habit, today: string, window = 30): { done: number; due: number; percent: number } | null {
  const from = [addDays(today, -(window - 1)), firstDay(habit) ?? today].sort()[1]
  let due = 0
  let doneCount = 0
  for (let day = from; day <= today; day = addDays(day, 1)) {
    const d = isDone(habit, day)
    if (!isDue(habit, day) || (day === today && !d)) continue
    due++
    if (d) doneCount++
  }
  if (due === 0) return null
  return { done: doneCount, due, percent: Math.round((doneCount / due) * 100) }
}

export type CellState = 'done' | 'missed' | 'rest' | 'today' | 'before' | 'future'

/** One state per day from `from` to `to` (inclusive), for dot rows and the history grid. */
export function habitCells(habit: Habit, from: string, to: string, today: string): Array<{ day: string; state: CellState }> {
  const first = firstDay(habit) ?? today
  const cells: Array<{ day: string; state: CellState }> = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    let state: CellState
    if (isDone(habit, day)) state = 'done'
    else if (day > today) state = 'future'
    else if (day < first) state = 'before'
    else if (!isDue(habit, day)) state = 'rest'
    else state = day === today ? 'today' : 'missed'
    cells.push({ day, state })
  }
  return cells
}

/** The last due day before today was missed: "never miss twice" applies today. */
export function missedLast(habit: Habit, today: string): boolean {
  const first = firstDay(habit) ?? today
  for (let back = 1; back <= 7; back++) {
    const day = addDays(today, -back)
    if (day < first) return false
    if (isDue(habit, day)) return !isDone(habit, day)
  }
  return false
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Daily", "Weekdays", "Weekends", or "Mon Wed Fri" (Monday first). */
export function daysLabel(days: readonly number[]): string {
  const set = [...new Set(days)].sort()
  if (set.length === 7) return 'Daily'
  if (set.join() === '1,2,3,4,5') return 'Weekdays'
  if (set.join() === '0,6') return 'Weekends'
  return set
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => DAY_NAMES[d])
    .join(' ')
}
