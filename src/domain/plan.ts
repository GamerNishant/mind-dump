/**
 * Typed planner records (stored as PlannerDoc.data, see src/domain/planner.ts).
 *
 * The planner implements the "4 AM Engine" daily system (docs: DESIGN.md §Planner):
 * Today is an ordered Queue of Blocks (deep work, timed) and Tasks (small), fed from dump tiles.
 * Nothing leaves Today silently: every item ends Done or Skipped with a reason (Start, Shrink, Say).
 */

export const KIND = {
  todayItem: 'today_item',
  tileMeta: 'tile_meta',
  focus: 'focus_session',
  hourLog: 'hour_log',
  dayPlan: 'day_plan',
  rule: 'rule',
  settings: 'settings',
  habit: 'habit',
  compass: 'compass',
} as const

export const ALL_KINDS: readonly string[] = Object.values(KIND)

export type ItemType = 'block' | 'task'
export type ItemStatus = 'open' | 'done' | 'skipped'

export const SKIP_REASONS = ['tired', 'too_big', 'interrupted', 'didnt_want', 'phone', 'forgot', 'not_relevant'] as const
/**
 * Reasons the user picks are SKIP_REASONS. System reasons: `unresolved` (a routine left open
 * when its day ended, or a duplicate merged at rollover), `restart` (closed by Restart),
 * `not_today` (taken off a queue without a skip reason), `deleted` (its tile was deleted or split).
 */
export type SkipReason = (typeof SKIP_REASONS)[number] | 'unresolved' | 'restart' | 'not_today' | 'deleted'

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  tired: 'Tired',
  too_big: 'Too big',
  interrupted: 'Interrupted',
  didnt_want: "Didn't want",
  phone: 'Phone',
  forgot: 'Forgot',
  unresolved: 'Not resolved',
  restart: 'Restart',
  not_today: 'Not today',
  deleted: 'Tile removed',
  not_relevant: 'No longer relevant',
}

/** Where a skipped item goes: end of today's queue, tomorrow, or off Today (it stays in the dump). */
export type SkipTo = 'later' | 'tomorrow' | 'dump'

export interface SkipEvent {
  at: string
  reason: SkipReason
  to: SkipTo
}

export interface TodayItem {
  /** Source dump tile; null for the rare item that isn't backed by a tile. */
  dumpId: string | null
  title: string
  type: ItemType
  /** Block length in minutes (blocks only). */
  minutes: number
  /** One physical first action, ≤ ~10 words ("Pen in hand, PSIR index p.14"). */
  firstAction: string
  /** Output floor you could hit on a bad day ("5 bullet notes"). */
  minimum: string
  /** Fractional ordering key, ascending (same scheme as dumps). */
  order: number
  status: ItemStatus
  /** Block's minimum output was met. */
  minMet: boolean
  skips: SkipEvent[]
  /** Day this item was carried over from (most recent carry). */
  carriedFrom: string | null
  carryCount: number
  /** Created automatically from a recurring tile. */
  routine: boolean
  /** Habit routines (meals, snack) don't count toward the queue caps. */
  habit: boolean
  doneAt: string | null
}

export type RepeatDays = number[] // 0 = Sunday … 6 = Saturday (Date#getDay)

/** Planner info about a dump tile. Doc id = the dump's id (one per tile). */
export interface TileMeta {
  dumpId: string
  /** Weekdays this tile recurs on; null/empty = doesn't repeat. */
  repeat: RepeatDays | null
  defaultType: ItemType
  defaultMinutes: number
  habit: boolean
  /** The Bookmark: where you stopped last time; becomes the next first action. */
  resumeNote: string
  defaultMinimum: string
  skipCount: number
  carryCount: number
  /** How much the tile matters; null = not set. */
  priority: Priority | null
}

export const PRIORITIES = ['high', 'medium', 'low'] as const
export type Priority = (typeof PRIORITIES)[number]

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/** Sort rank: high first, unset last. */
export const priorityRank = (p: Priority | null | undefined) => (p === 'high' ? 0 : p === 'medium' ? 1 : p === 'low' ? 2 : 3)

export const isPriority = (v: unknown): v is Priority => PRIORITIES.includes(v as Priority)

export interface FocusSession {
  itemId: string | null
  dumpId: string | null
  title: string
  firstAction: string
  minimum: string
  plannedMin: number
  /** Started with "Do just 2 minutes". */
  starter: boolean
  startedAt: string
  /** Set while paused. */
  pausedAt: string | null
  pausedMs: number
  endedAt: string | null
  minMet: boolean | null
  stoppedAt: string
  /** Its Study hours were filled in the hour log (absent on sessions from older versions). */
  hoursLogged?: boolean
}

export const HOUR_CATEGORIES = ['study', 'phone', 'sleep', 'food', 'build', 'chores', 'leisure', 'other'] as const
export type HourCategory = (typeof HOUR_CATEGORIES)[number]

export const HOUR_CATEGORY_LABEL: Record<HourCategory, string> = {
  study: 'Study',
  phone: 'Phone / random',
  sleep: 'Sleep',
  food: 'Food',
  build: 'Build',
  chores: 'Chores',
  leisure: 'Leisure',
  other: 'Other',
}

/**
 * What an hour was spent on: a category, or `other:<tag>` for an "Other" hour the user named
 * ("other:Gym"). Unknown values read as plain Other (see src/lib/hours.ts).
 */
export type HourValue = HourCategory | `other:${string}`

/** One per day. Keys are clock hours "0"…"23". */
export interface HourLog {
  hours: Partial<Record<string, HourValue>>
}

export const MAX_TAG_LENGTH = 24

/**
 * A daily habit (habit stack): not a task, just something to do on its due days. One tap logs
 * it. `done` holds the planner days it was done, so streaks need no extra documents.
 */
export interface Habit {
  name: string
  /** Weekdays it is due (Date#getDay); all 7 = daily. */
  days: number[]
  /** Planner days (YYYY-MM-DD) it was done, ascending. */
  done: string[]
  order: number
  /** Planner day it was added; days before it don't count against consistency. */
  startDay: string
}

export const MAX_HABIT_NAME = 80

/**
 * Compass: one undated document per user (`compassId`). It holds the "Find your fire" answers,
 * the candidate directions with their scores, and the running 14-day Spark experiment.
 */
export interface Compass {
  /** Prompt id (COMPASS_PROMPTS) → the user's answer. */
  answers: Record<string, string>
  candidates: Candidate[]
  fire: Fire | null
  /** Finished experiments, newest first. */
  past: PastFire[]
}

/** The five ways a candidate is scored, each 1–5. */
export const SCORE_DIMS = ['pull', 'curiosity', 'regret', 'meaning', 'fit'] as const
export type ScoreDim = (typeof SCORE_DIMS)[number]

export interface Candidate {
  id: string
  title: string
  scores: Partial<Record<ScoreDim, number>>
  /** Head-to-head picks won in the Duel step. */
  wins: number
  /** Head-to-head picks it took part in. */
  duels: number
}

/** The direction being tested: a daily block (a recurring tile) and a check-in after each session. */
export interface Fire {
  title: string
  /** One sentence in the user's own words. */
  why: string
  /** What will exist at the end that doesn't exist now. */
  output: string
  /** Daily minutes. */
  minutes: number
  firstAction: string
  /** "After I ___" cue (implementation intention). */
  cue: string
  startDay: string
  lengthDays: number
  /** The recurring tile that puts a block in Today every day. */
  dumpId: string | null
  runnerUp: string | null
  sparks: Spark[]
}

/** One check-in after a session. */
export interface Spark {
  day: string
  minutes: number
  /** How you felt afterwards, 1 (drained) to 5 (alive). */
  energy: number
  /** Time flew. */
  flow: boolean
  note: string
}

export type Verdict = 'keep' | 'reshape' | 'switch' | 'restart'

export interface PastFire {
  title: string
  startDay: string
  endDay: string
  verdict: Verdict
  meter: number
  sparks: number
}

export const FIRE_DAYS = 14
export const FIRE_MINUTES = [15, 25, 45, 60] as const
export const MAX_ANSWER = 600
export const MAX_CANDIDATES = 8
export const MAX_FIRE_TEXT = 160

export const emptyCompass = (): Compass => ({ answers: {}, candidates: [], fire: null, past: [] })
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

export type Block1Result = 'yes' | 'partly' | 'no'

/** One per day. */
export interface DayPlan {
  morningCheckAt: string | null
  block1: { result: Block1Result; stoppedAt: string } | null
  shutdownAt: string | null
  blocksDone: number
  floorMet: boolean
  foodSorted: boolean
  /** Shutdown's closing line: "Tomorrow starts with …" (stored on the day it was written). */
  tomorrowFirst: string
  restartAt: string | null
}

export interface Rule {
  ifText: string
  thenText: string
  /** Skip reason this rule answers; shown in the Skip sheet when that reason is picked. */
  reason: SkipReason | null
  active: boolean
  order: number
}

export interface PlanSettings {
  /** Max deep blocks in a day's queue (the Ramp: start at 2, max 4). */
  blockCap: number
  taskCap: number
  /** Hour (local) at which a new planner day starts; late nights belong to the previous day. */
  dayStartHour: number
  rulesSeeded: boolean
  /** Names the user gave to "Other" hours, offered as quick picks next time. */
  otherTags: string[]
}

export const DEFAULT_SETTINGS: PlanSettings = { blockCap: 2, taskCap: 5, dayStartHour: 3, rulesSeeded: false, otherTags: [] }

export const BLOCK_MINUTES = [25, 50, 90] as const
export const DEFAULT_BLOCK_MINUTES = 50
export const MAX_BLOCK_CAP = 4
export const STARTER_MINUTES = 2
export const SHRUNK_MINUTES = 10
export const SHUTDOWN_MINUTES = 10
/** From this hour (local) the Shutdown prompt comes forward; before it, it stays tucked away. */
export const WIND_DOWN_HOUR = 20
/** Carried this many times → "Too big? Split it." */
export const CARRY_WARN = 3

export const SEED_RULES: Array<Pick<Rule, 'ifText' | 'thenText' | 'reason'>> = [
  { ifText: 'I wake at 4 and reach for the phone', thenText: 'Remember it lives in the kitchen by design. Go to the desk and say "Book open. One heading."', reason: 'phone' },
  { ifText: "I sit down at 4 and there's no plan from last night", thenText: "Open the Bookmark and read the next heading for 2 minutes. Don't plan at 4 AM.", reason: 'forgot' },
  { ifText: "I want to open the laptop \"just to check\" before Block 1's minimum is done", thenText: 'Write it on the scratch sheet. The laptop opens only after the minimum.', reason: 'phone' },
  { ifText: "a block's start arrives and I don't feel like it", thenText: 'Start, Shrink, Say: 2 minutes of the first action first, then decide.', reason: 'didnt_want' },
  { ifText: "I notice I'm in a phone or random-browsing loop", thenText: 'Phone face down in another room, open Today and press Start on the next item.', reason: 'phone' },
  { ifText: 'an idea for a feature, tool or new system comes up during a block', thenText: 'Park it as a #build tile in 10 seconds and go back to the page. Only the Sunday Build Box looks at it.', reason: null },
  { ifText: 'something "urgent" comes up during a block', thenText: 'Ask: can it wait until the Buffer? If yes, dump it. If no, do it, and the block runs next at its minimum.', reason: 'interrupted' },
  { ifText: "the timer ends and the output isn't finished", thenText: 'Stop, write "stopped at ___". That is the next first action.', reason: 'too_big' },
  { ifText: "I'm hungry and there's no ready food", thenText: 'Make a 5-minute staples plate (eggs + toast, curd + fruit + chana, paneer + roti).', reason: null },
  { ifText: 'I want to order food on any day except Saturday', thenText: 'Eat the staples plate first and wait 15 minutes. If I still order, log the home meal as skipped with a reason.', reason: null },
  { ifText: 'I feel sleepy after lunch', thenText: "Set the physical timer before lying down. If I'm not asleep in 15 minutes, get up and walk.", reason: 'tired' },
  { ifText: 'I overslept the nap', thenText: 'Get up now (light, water, face), eat the snack, do the next block at its minimum. Bedtime stays the same.', reason: 'tired' },
  { ifText: "it's past 7:15 PM and I want to start a movie", thenText: 'Shutdown first. The movie starts after "Shutdown complete", with its end time set before I press play.', reason: null },
  { ifText: 'my leisure end time comes and I want "one more episode"', thenText: 'Close the laptop, phone on the kitchen charger. The episode goes to tomorrow.', reason: null },
  { ifText: 'I catch myself redesigning this system or the app on a weekday', thenText: 'Dump it as #build. The system only changes in the Sunday review.', reason: null },
]

export const emptyDayPlan = (): DayPlan => ({
  morningCheckAt: null,
  block1: null,
  shutdownAt: null,
  blocksDone: 0,
  floorMet: false,
  foodSorted: false,
  tomorrowFirst: '',
  restartAt: null,
})

export const defaultTileMeta = (dumpId: string): TileMeta => ({
  dumpId,
  repeat: null,
  // Most tiles are small to-dos; the type you pick in Today is remembered per tile.
  defaultType: 'task',
  defaultMinutes: DEFAULT_BLOCK_MINUTES,
  habit: false,
  resumeNote: '',
  defaultMinimum: '',
  skipCount: 0,
  carryCount: 0,
  priority: null,
})
