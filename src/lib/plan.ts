import type { PlannerDoc } from '@/domain/planner'
import {
  defaultTileMeta,
  KIND,
  type DayPlan,
  type FocusSession,
  type HourCategory,
  type HourLog,
  type ItemType,
  type PlanSettings,
  type TileMeta,
  type TodayItem,
} from '@/domain/plan'
import type { PlannerDocInput } from '@/data/types'
import { POSITION_STEP } from './position'

// ---- planner days ------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of a local calendar date. */
export function dayOfDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The planner day `now` belongs to. A day starts at `startHour` (default 3 AM), so 1 AM is
 * still "yesterday" and a 4 AM start is "today".
 */
export function planDay(now: Date, startHour = 3): string {
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - startHour, now.getMinutes())
  return dayOfDate(shifted)
}

/** Local noon of a day key: safe from DST edges for date arithmetic. */
export function dateOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function addDays(day: string, n: number): string {
  const date = dateOfDay(day)
  date.setDate(date.getDate() + n)
  return dayOfDate(date)
}

/** Whole days from `a` to `b` (b - a). */
export function daysFrom(a: string, b: string): number {
  return Math.round((dateOfDay(b).getTime() - dateOfDay(a).getTime()) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return dateOfDay(day).getDay()
}

export function dayLabel(day: string, today: string): string {
  const diff = daysFrom(today, day)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return dateOfDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---- stable ids --------------------------------------------------------------

/**
 * Deterministic UUID-shaped id from its parts. Per-day singletons (a day's plan, its hour log)
 * and routine instances use these, so two devices creating "the same" document can't duplicate it.
 */
export function stableId(...parts: string[]): string {
  const input = parts.join('|')
  // cyrb128: four 32-bit lanes.
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('')
  // Shape as a v4-style UUID (version and variant nibbles) so it fits a uuid column.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// `planner_docs.id` is a global primary key, so per-user singletons must include the user id.
export const dayPlanId = (userId: string, day: string) => stableId(KIND.dayPlan, userId, day)
export const hourLogId = (userId: string, day: string) => stableId(KIND.hourLog, userId, day)
export const settingsId = (userId: string) => stableId(KIND.settings, userId)
export const seedRuleId = (userId: string, index: number) => stableId(KIND.rule, 'seed', userId, String(index))
/** Dump ids are already unique per user. */
export const routineItemId = (dumpId: string, day: string) => stableId(KIND.todayItem, 'routine', dumpId, day)

// ---- typed views over the docs map --------------------------------------------

export type Docs = ReadonlyMap<string, PlannerDoc>
export type Doc<T> = PlannerDoc<T>

export function docsOfKind<T>(docs: Docs, kind: string): Array<Doc<T>> {
  const out: Array<Doc<T>> = []
  for (const d of docs.values()) if (d.kind === kind) out.push(d as Doc<T>)
  return out
}

export const byOrder = (a: Doc<TodayItem>, b: Doc<TodayItem>) =>
  a.data.order - b.data.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

/** Items planned for `day`, in queue order. */
export function itemsForDay(docs: Docs, day: string): Array<Doc<TodayItem>> {
  return docsOfKind<TodayItem>(docs, KIND.todayItem)
    .filter((d) => d.day === day)
    .sort(byOrder)
}

/** dumpId → TileMeta (defaults filled in). */
export function tileMetaMap(docs: Docs): Map<string, TileMeta> {
  const map = new Map<string, TileMeta>()
  for (const d of docsOfKind<TileMeta>(docs, KIND.tileMeta)) map.set(d.data.dumpId, { ...defaultTileMeta(d.data.dumpId), ...d.data })
  return map
}

/**
 * The singleton document of a kind (and day). Looked up by kind/day rather than id, since only
 * the signed-in user's documents are loaded; if several exist, the most recently updated wins.
 */
export function singleton<T>(docs: Docs, kind: string, day: string | null): Doc<T> | undefined {
  let best: Doc<T> | undefined
  for (const d of docs.values()) {
    if (d.kind !== kind || d.day !== day) continue
    if (!best || d.updatedAt > best.updatedAt) best = d as Doc<T>
  }
  return best
}

export function settingsOf(docs: Docs, fallback: PlanSettings): PlanSettings {
  return { ...fallback, ...singleton<Partial<PlanSettings>>(docs, KIND.settings, null)?.data }
}

export function dayPlanOf(docs: Docs, day: string, empty: () => DayPlan): DayPlan {
  return { ...empty(), ...singleton<Partial<DayPlan>>(docs, KIND.dayPlan, day)?.data }
}

export function hourLogOf(docs: Docs, day: string): HourLog {
  return { hours: { ...singleton<Partial<HourLog>>(docs, KIND.hourLog, day)?.data?.hours } }
}

/** The running (not ended) focus session, newest first if several exist. */
export function activeFocus(docs: Docs): Doc<FocusSession> | null {
  const running = docsOfKind<FocusSession>(docs, KIND.focus).filter((d) => !d.data.endedAt)
  running.sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt))
  return running[0] ?? null
}

// ---- queue rules ---------------------------------------------------------------

/** Items that occupy queue capacity: not skipped, and not habits. */
export function capUsage(items: ReadonlyArray<Doc<TodayItem>>): { blocks: number; tasks: number } {
  let blocks = 0
  let tasks = 0
  for (const { data } of items) {
    if (data.status === 'skipped' || data.habit) continue
    if (data.type === 'block') blocks++
    else tasks++
  }
  return { blocks, tasks }
}

export function hasRoomFor(type: ItemType, items: ReadonlyArray<Doc<TodayItem>>, settings: PlanSettings): boolean {
  const used = capUsage(items)
  return type === 'block' ? used.blocks < settings.blockCap : used.tasks < settings.taskCap
}

export const orderAtEnd = (items: ReadonlyArray<Doc<TodayItem>>) =>
  items.length ? Math.max(...items.map((i) => i.data.order)) + POSITION_STEP : 0

export const orderAtStart = (items: ReadonlyArray<Doc<TodayItem>>) =>
  items.length ? Math.min(...items.map((i) => i.data.order)) - POSITION_STEP : 0

/** The first open item in queue order: the "Next" card. */
export const nextItem = (items: ReadonlyArray<Doc<TodayItem>>) => items.find((i) => i.data.status === 'open') ?? null

/** Blocks whose minimum was met that day. */
export const blocksDone = (items: ReadonlyArray<Doc<TodayItem>>) =>
  items.filter((i) => i.data.type === 'block' && i.data.status === 'done' && i.data.minMet).length

/** The Floor (Minimum Day): at least one block's minimum met, plus shutdown. */
export const floorMet = (items: ReadonlyArray<Doc<TodayItem>>, plan: DayPlan) => blocksDone(items) > 0 && !!plan.shutdownAt

export type DotState = 'hit' | 'miss' | 'today'

/** Last 7 days ending today (oldest first). Today shows as a ring until its Floor is hit. */
export function floorDots(docs: Docs, today: string, empty: () => DayPlan): Array<{ day: string; state: DotState }> {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    const met = floorMet(itemsForDay(docs, day), dayPlanOf(docs, day, empty))
    return { day, state: met ? 'hit' : day === today ? 'today' : 'miss' }
  })
}

// ---- new items ---------------------------------------------------------------------

export function newItem(fields: Partial<TodayItem> & Pick<TodayItem, 'title' | 'order'>): TodayItem {
  return {
    dumpId: null,
    type: 'task',
    minutes: 50,
    firstAction: '',
    minimum: '',
    status: 'open',
    minMet: false,
    skips: [],
    carriedFrom: null,
    carryCount: 0,
    routine: false,
    habit: false,
    doneAt: null,
    ...fields,
  }
}

/** Title for an item made from a dump: its first line. */
export function titleFromDump(content: string): string {
  const first = content.split(/\r?\n/).find((l) => l.trim()) ?? content
  return first.trim().slice(0, 300)
}

/** First action for a tile with a Bookmark. */
export const resumeAction = (note: string) => (note.trim() ? `Resume: ${note.trim()}` : '')

// ---- rollover ------------------------------------------------------------------------

export interface RolloverInput {
  docs: Docs
  today: string
  /** Ids and contents of dumps still on the board. */
  activeDumps: ReadonlyArray<{ id: string; content: string }>
}

export interface RolloverPlan {
  /** Updates to existing docs (carry-overs, routines closed as unresolved, tile meta counters). */
  updates: PlannerDocInput[]
  /** Routine instances for today; create only if missing (another device may have made them). */
  creates: PlannerDocInput[]
  /** Open, non-routine items from before yesterday: the "Welcome back / Restart" decision. */
  stale: Array<Doc<TodayItem>>
}

/**
 * What has to change when a planner day starts (or the app is first opened on a new day):
 * - yesterday's open, non-routine items carry over to today (carryCount + 1);
 * - routine items left open on an earlier day close as skipped "Not resolved" (never carried);
 * - recurring tiles due today get their routine item (idempotent, deterministic id);
 * - older open items are reported as `stale` for the user to Restart or bring back.
 * Pure: returns writes, performs none. Running it twice is harmless.
 */
export function planRollover({ docs, today, activeDumps }: RolloverInput): RolloverPlan {
  const yesterday = addDays(today, -1)
  const at = new Date().toISOString()
  const updates: PlannerDocInput[] = []
  const creates: PlannerDocInput[] = []
  const stale: Array<Doc<TodayItem>> = []
  const metas = tileMetaMap(docs)
  const metaCarry = new Map<string, number>()

  const all = docsOfKind<TodayItem>(docs, KIND.todayItem)
  const todays = all.filter((d) => d.day === today)
  let carryOrder = orderAtEnd(todays)
  // Tiles that already have a live item today: never give them a second one.
  const occupied = new Set(todays.filter((t) => t.data.status !== 'skipped' && t.data.dumpId).map((t) => t.data.dumpId!))

  for (const doc of all) {
    if (!doc.day || doc.day >= today || doc.data.status !== 'open') continue
    const duplicate = !!doc.data.dumpId && occupied.has(doc.data.dumpId)
    if (doc.data.routine || (duplicate && doc.day === yesterday)) {
      const skip = { at, reason: 'unresolved' as const, to: duplicate ? ('tomorrow' as const) : ('dump' as const) }
      updates.push({ ...doc, data: { ...doc.data, status: 'skipped', skips: [...doc.data.skips, skip] } })
    } else if (doc.day === yesterday) {
      if (doc.data.dumpId) occupied.add(doc.data.dumpId)
      const carryCount = doc.data.carryCount + 1
      updates.push({ ...doc, day: today, data: { ...doc.data, carriedFrom: yesterday, carryCount, order: carryOrder } })
      carryOrder += POSITION_STEP
      if (doc.data.dumpId) metaCarry.set(doc.data.dumpId, Math.max(metaCarry.get(doc.data.dumpId) ?? 0, carryCount))
    } else {
      stale.push(doc)
    }
  }

  for (const [dumpId, carryCount] of metaCarry) {
    const meta = metas.get(dumpId) ?? defaultTileMeta(dumpId)
    if (meta.carryCount !== carryCount) updates.push({ id: dumpId, kind: KIND.tileMeta, day: null, data: { ...meta, carryCount } })
  }

  creates.push(...routineCreates(docs, today, activeDumps, occupied))
  stale.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? '') || byOrder(a, b))
  return { updates, creates, stale }
}

/**
 * Routine items for recurring tiles due on `day` that don't have one yet: neither the
 * deterministic routine id nor any live item for the same tile that day (`occupied`).
 * Used by the rollover (for today) and by Shutdown (to prepare tomorrow early).
 */
export function routineCreates(
  docs: Docs,
  day: string,
  activeDumps: ReadonlyArray<{ id: string; content: string }>,
  occupied: ReadonlySet<string> = new Set(
    itemsForDay(docs, day)
      .filter((t) => t.data.status !== 'skipped' && t.data.dumpId)
      .map((t) => t.data.dumpId!),
  ),
): PlannerDocInput[] {
  const metas = tileMetaMap(docs)
  const weekday = weekdayOf(day)
  const due = activeDumps.filter((d) => metas.get(d.id)?.repeat?.includes(weekday))
  const creates: PlannerDocInput[] = []
  let routineOrder = orderAtStart(itemsForDay(docs, day)) - POSITION_STEP * due.length
  for (const dump of due) {
    const id = routineItemId(dump.id, day)
    routineOrder += POSITION_STEP
    if (docs.has(id) || occupied.has(dump.id)) continue
    const meta = metas.get(dump.id)!
    const item = newItem({
      dumpId: dump.id,
      title: titleFromDump(dump.content),
      type: meta.defaultType,
      minutes: meta.defaultMinutes,
      firstAction: resumeAction(meta.resumeNote),
      minimum: meta.defaultMinimum,
      order: routineOrder,
      routine: true,
      habit: meta.habit,
    })
    creates.push({ id, kind: KIND.todayItem, day, data: item })
  }
  return creates
}

// ---- hour log ---------------------------------------------------------------------------

/** Clock hours shown in the strip for a day, starting at the day-start hour (24 cells). */
export function stripHours(startHour: number): number[] {
  return Array.from({ length: 24 }, (_, i) => (startHour + i) % 24)
}

/**
 * Hours a session mostly covered (≥ 30 min of the hour), for auto-filling Study cells.
 * Returns clock hours paired with the planner day each falls in.
 */
export function coveredHours(start: Date, end: Date, startHour: number): Array<{ day: string; hour: number }> {
  const out: Array<{ day: string; hour: number }> = []
  const cursor = new Date(start)
  cursor.setMinutes(0, 0, 0)
  while (cursor < end) {
    const next = new Date(cursor.getTime() + 3_600_000)
    const overlap = Math.min(next.getTime(), end.getTime()) - Math.max(cursor.getTime(), start.getTime())
    if (overlap >= 30 * 60_000) out.push({ day: planDay(cursor, startHour), hour: cursor.getHours() })
    cursor.setTime(next.getTime())
  }
  return out
}

export function hourSummary(log: HourLog): Array<{ category: HourCategory; hours: number }> {
  const counts = new Map<HourCategory, number>()
  for (const c of Object.values(log.hours)) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  return [...counts].map(([category, hours]) => ({ category, hours })).sort((a, b) => b.hours - a.hours)
}

// ---- focus --------------------------------------------------------------------------------

/** Milliseconds of focus elapsed (excluding pauses). */
export function focusElapsedMs(session: FocusSession, now: Date): number {
  const end = session.endedAt ? Date.parse(session.endedAt) : session.pausedAt ? Date.parse(session.pausedAt) : now.getTime()
  return Math.max(0, end - Date.parse(session.startedAt) - session.pausedMs)
}

export function focusRemainingMs(session: FocusSession, now: Date): number {
  return session.plannedMin * 60_000 - focusElapsedMs(session, now)
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
