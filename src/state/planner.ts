import type { Dump } from '@/domain/dump'
import {
  DEFAULT_SETTINGS,
  defaultTileMeta,
  emptyDayPlan,
  KIND,
  SEED_RULES,
  SHRUNK_MINUTES,
  STARTER_MINUTES,
  type Block1Result,
  type DayPlan,
  type FocusSession,
  type HourCategory,
  type PlanSettings,
  type Rule,
  type SkipReason,
  type SkipTo,
  type TileMeta,
  type TodayItem,
} from '@/domain/plan'
import type { PlannerDocInput } from '@/data/types'
import { newId } from '@/lib/id'
import {
  activeFocus,
  addDays,
  coveredHours,
  dayPlanId,
  dayPlanOf,
  docsOfKind,
  floorMet,
  hasRoomFor,
  hourLogId,
  hourLogOf,
  itemsForDay,
  newItem,
  orderAtEnd,
  planDay,
  resumeAction,
  settingsId,
  settingsOf,
  tileMetaMap,
  titleFromDump,
  blocksDone,
  type Doc,
} from '@/lib/plan'
import { planMove } from '@/lib/position'
import type { DumpsStore } from './dumpsStore'
import type { PlannerStore } from './plannerStore'

export type AddResult = { ok: true; id: string } | { ok: false; reason: 'exists' | 'full' | 'error' }

/**
 * Planner use-cases on top of the generic PlannerStore (and DumpsStore for tiles).
 * Every method reads the latest store state, computes whole new documents, and writes them
 * through the store (optimistic, rolled back on failure). UI components call only these.
 */
export class Planner {
  readonly store: PlannerStore
  private readonly dumps: DumpsStore

  constructor(store: PlannerStore, dumps: DumpsStore) {
    this.store = store
    this.dumps = dumps
  }

  // ---- reads ---------------------------------------------------------------

  private get docs() {
    return this.store.getState().docs
  }

  settings(): PlanSettings {
    return settingsOf(this.docs, DEFAULT_SETTINGS)
  }

  today(now = new Date()): string {
    return planDay(now, this.settings().dayStartHour)
  }

  private item(id: string): Doc<TodayItem> | null {
    const doc = this.docs.get(id)
    return doc?.kind === KIND.todayItem ? (doc as Doc<TodayItem>) : null
  }

  private meta(dumpId: string): TileMeta {
    return tileMetaMap(this.docs).get(dumpId) ?? defaultTileMeta(dumpId)
  }

  private putItem(doc: Doc<TodayItem>, data: Partial<TodayItem>, extra: Partial<PlannerDocInput> = {}, error?: string) {
    return this.store.put({ id: doc.id, kind: KIND.todayItem, day: doc.day, data: { ...doc.data, ...data }, ...extra }, error)
  }

  private metaDoc(meta: TileMeta): PlannerDocInput {
    return { id: meta.dumpId, kind: KIND.tileMeta, day: null, data: meta }
  }

  // ---- Today queue --------------------------------------------------------------

  /** "+ Today" on a dump tile. The tile stays on the board. */
  async addFromDump(dump: Dump, day = this.today()): Promise<AddResult> {
    const items = itemsForDay(this.docs, day)
    if (items.some((i) => i.data.dumpId === dump.id && i.data.status !== 'skipped')) return { ok: false, reason: 'exists' }
    const meta = this.meta(dump.id)
    if (!meta.habit && !hasRoomFor(meta.defaultType, items, this.settings())) return { ok: false, reason: 'full' }
    const id = newId()
    const data = newItem({
      dumpId: dump.id,
      title: titleFromDump(dump.content),
      type: meta.defaultType,
      minutes: meta.defaultMinutes,
      firstAction: resumeAction(meta.resumeNote),
      minimum: meta.defaultMinimum,
      habit: meta.habit,
      order: orderAtEnd(items),
    })
    const ok = await this.store.put({ id, kind: KIND.todayItem, day, data }, "Couldn't add that to Today")
    return ok ? { ok: true, id } : { ok: false, reason: 'error' }
  }

  /** Typing a new item in Today also creates its dump tile, so the dump stays the single source. */
  async addText(text: string, type: TodayItem['type'], day = this.today()): Promise<AddResult> {
    const items = itemsForDay(this.docs, day)
    if (!hasRoomFor(type, items, this.settings())) return { ok: false, reason: 'full' }
    const created = await this.dumps.addMany([text])
    const dump = created?.[0]
    if (!dump) return { ok: false, reason: 'error' }
    if (type !== 'task') await this.store.put(this.metaDoc({ ...this.meta(dump.id), defaultType: type }))
    return this.addFromDump(dump, day)
  }

  /** Edit fields. Type/length/minimum changes are remembered on the tile for next time. */
  async updateItem(id: string, patch: Partial<Pick<TodayItem, 'title' | 'type' | 'minutes' | 'firstAction' | 'minimum'>>): Promise<boolean> {
    const doc = this.item(id)
    if (!doc) return false
    if (patch.type === 'block' && doc.data.type !== 'block' && !doc.data.habit) {
      const others = itemsForDay(this.docs, doc.day ?? this.today()).filter((i) => i.id !== id)
      if (!hasRoomFor('block', others, this.settings())) return false
    }
    const ok = await this.putItem(doc, patch)
    const { dumpId } = doc.data
    if (ok && dumpId && (patch.type || patch.minutes || patch.minimum !== undefined)) {
      const meta = this.meta(dumpId)
      await this.store.put(
        this.metaDoc({
          ...meta,
          defaultType: patch.type ?? meta.defaultType,
          defaultMinutes: patch.minutes ?? meta.defaultMinutes,
          defaultMinimum: patch.minimum ?? meta.defaultMinimum,
        }),
      )
    }
    return ok
  }

  /** Drag reorder. `orderedIds` is the queue order the user saw after the drop. */
  reorder(day: string, movedId: string, orderedIds: string[]): Promise<boolean> {
    const byId = new Map(itemsForDay(this.docs, day).map((d) => [d.id, d]))
    const ordered = orderedIds.map((id) => byId.get(id)).filter((d): d is Doc<TodayItem> => !!d)
    const index = ordered.findIndex((d) => d.id === movedId)
    if (index < 0) return Promise.resolve(false)
    const updates = planMove(
      ordered.map((d) => ({ id: d.id, position: d.data.order })),
      index,
    )
    return this.store.put(
      updates.map((u) => {
        const doc = byId.get(u.id)!
        return { id: doc.id, kind: KIND.todayItem, day: doc.day, data: { ...doc.data, order: u.position } }
      }),
      "Couldn't save the new order",
    )
  }

  complete(id: string, minMet = true): Promise<boolean> {
    const doc = this.item(id)
    if (!doc) return Promise.resolve(false)
    return this.putItem(doc, { status: 'done', minMet, doneAt: new Date().toISOString() })
  }

  /** Undo for Done / Skip-to-dump. */
  reopen(id: string): Promise<boolean> {
    const doc = this.item(id)
    if (!doc) return Promise.resolve(false)
    return this.putItem(doc, { status: 'open', minMet: false, doneAt: null })
  }

  /** Remove an item added by mistake (undo of "+ Today"). Items are otherwise never deleted. */
  removeItem(id: string): Promise<boolean> {
    return this.store.remove(id, "Couldn't remove that")
  }

  /** "Say": skip with a reason and a destination. Never silent. */
  async skip(id: string, reason: SkipReason, to: SkipTo): Promise<boolean> {
    const doc = this.item(id)
    if (!doc) return false
    const event = { at: new Date().toISOString(), reason, to }
    const skips = [...doc.data.skips, event]
    const day = doc.day ?? this.today()
    let ok: boolean
    if (to === 'later') {
      ok = await this.putItem(doc, { skips, order: orderAtEnd(itemsForDay(this.docs, day)) })
    } else if (to === 'tomorrow') {
      const tomorrow = addDays(day, 1)
      ok = await this.putItem(doc, { skips, order: orderAtEnd(itemsForDay(this.docs, tomorrow)) }, { day: tomorrow })
    } else {
      ok = await this.putItem(doc, { skips, status: 'skipped' })
    }
    if (ok && doc.data.dumpId) {
      const meta = this.meta(doc.data.dumpId)
      await this.store.put(this.metaDoc({ ...meta, skipCount: meta.skipCount + 1 }))
    }
    return ok
  }

  // ---- Focus ------------------------------------------------------------------------

  running(): Doc<FocusSession> | null {
    return activeFocus(this.docs)
  }

  /**
   * Start a focus block on an item. `mode`: 'full' (its minutes), 'starter' (shows "just 2
   * minutes", runs on into the full block) or 'shrink' (10 minutes / minimum only).
   * Resolves to the session id (an already-running session is returned instead).
   */
  async startFocus(itemId: string, mode: 'full' | 'starter' | 'shrink' = 'full'): Promise<string | null> {
    const existing = this.running()
    if (existing) return existing.id
    const doc = this.item(itemId)
    if (!doc) return null
    if (mode === 'shrink') await this.putItem(doc, { minutes: SHRUNK_MINUTES })
    const minutes = mode === 'shrink' ? SHRUNK_MINUTES : doc.data.type === 'block' ? doc.data.minutes : 25
    const id = newId()
    const session: FocusSession = {
      itemId,
      dumpId: doc.data.dumpId,
      title: doc.data.title,
      firstAction: doc.data.firstAction,
      minimum: doc.data.minimum,
      plannedMin: Math.max(minutes, STARTER_MINUTES),
      starter: mode === 'starter',
      startedAt: new Date().toISOString(),
      pausedAt: null,
      pausedMs: 0,
      endedAt: null,
      minMet: null,
      stoppedAt: '',
    }
    const ok = await this.store.put({ id, kind: KIND.focus, day: doc.day ?? this.today(), data: session }, "Couldn't start the block")
    return ok ? id : null
  }

  private session(id: string): Doc<FocusSession> | null {
    const doc = this.docs.get(id)
    return doc?.kind === KIND.focus ? (doc as Doc<FocusSession>) : null
  }

  private putSession(doc: Doc<FocusSession>, data: Partial<FocusSession>) {
    return this.store.put({ id: doc.id, kind: KIND.focus, day: doc.day, data: { ...doc.data, ...data } })
  }

  pauseFocus(id: string): Promise<boolean> {
    const doc = this.session(id)
    if (!doc || doc.data.pausedAt || doc.data.endedAt) return Promise.resolve(false)
    return this.putSession(doc, { pausedAt: new Date().toISOString() })
  }

  resumeFocus(id: string): Promise<boolean> {
    const doc = this.session(id)
    if (!doc || !doc.data.pausedAt) return Promise.resolve(false)
    const pausedMs = doc.data.pausedMs + Math.max(0, Date.now() - Date.parse(doc.data.pausedAt))
    return this.putSession(doc, { pausedAt: null, pausedMs })
  }

  extendFocus(id: string, minutes: number): Promise<boolean> {
    const doc = this.session(id)
    if (!doc) return Promise.resolve(false)
    return this.putSession(doc, { plannedMin: doc.data.plannedMin + minutes })
  }

  /**
   * End a block: record the result, save "where I stopped" as the tile's Bookmark (and the item's
   * next first action), mark the item done if its minimum was met, and fill Study hours.
   */
  async endFocus(id: string, result: { minMet: boolean; stoppedAt: string }): Promise<boolean> {
    const doc = this.session(id)
    if (!doc) return false
    const now = new Date()
    const pausedMs = doc.data.pausedAt ? doc.data.pausedMs + Math.max(0, now.getTime() - Date.parse(doc.data.pausedAt)) : doc.data.pausedMs
    const stoppedAt = result.stoppedAt.trim()
    const ok = await this.putSession(doc, { endedAt: now.toISOString(), pausedAt: null, pausedMs, minMet: result.minMet, stoppedAt })
    if (!ok) return false

    const item = doc.data.itemId ? this.item(doc.data.itemId) : null
    if (item) {
      const patch: Partial<TodayItem> = result.minMet
        ? { status: 'done', minMet: true, doneAt: now.toISOString() }
        : {}
      if (stoppedAt) patch.firstAction = resumeAction(stoppedAt)
      if (Object.keys(patch).length) await this.putItem(item, patch)
    }
    if (doc.data.dumpId && stoppedAt) {
      await this.store.put(this.metaDoc({ ...this.meta(doc.data.dumpId), resumeNote: stoppedAt }))
    }

    // Wall-clock span minus pauses ≈ focus; fill the hours it mostly covered (only empty cells).
    const start = new Date(Date.parse(doc.data.startedAt) + pausedMs)
    const byDay = new Map<string, number[]>()
    for (const { day, hour } of coveredHours(start, now, this.settings().dayStartHour)) {
      byDay.set(day, [...(byDay.get(day) ?? []), hour])
    }
    for (const [day, hours] of byDay) await this.setHours(day, hours, 'study', { onlyEmpty: true })
    return true
  }

  // ---- Hour log --------------------------------------------------------------------------

  setHours(day: string, hours: number[], category: HourCategory | null, opts: { onlyEmpty?: boolean } = {}): Promise<boolean> {
    const log = hourLogOf(this.docs, day)
    const next = { ...log.hours }
    let changed = false
    for (const h of hours) {
      const key = String(h)
      if (opts.onlyEmpty && next[key]) continue
      if (category) {
        if (next[key] !== category) changed = true
        next[key] = category
      } else if (key in next) {
        delete next[key]
        changed = true
      }
    }
    if (!changed) return Promise.resolve(true)
    return this.store.put({ id: hourLogId(day), kind: KIND.hourLog, day, data: { hours: next } }, "Couldn't save the hour log")
  }

  // ---- Day plan: Morning Check, Shutdown, Restart -------------------------------------------

  dayPlan(day: string): DayPlan {
    return dayPlanOf(this.docs, day, emptyDayPlan)
  }

  private putPlan(day: string, patch: Partial<DayPlan>, error?: string) {
    return this.store.put({ id: dayPlanId(day), kind: KIND.dayPlan, day, data: { ...this.dayPlan(day), ...patch } }, error)
  }

  /** Block 1 = the first block in today's queue. */
  block1(day: string): Doc<TodayItem> | null {
    return itemsForDay(this.docs, day).find((i) => i.data.type === 'block' && i.data.status !== 'skipped') ?? null
  }

  async morningCheck(day: string, result: Block1Result | null, stoppedAt: string): Promise<boolean> {
    const note = stoppedAt.trim()
    const block = this.block1(day)
    if (block && result) {
      if (result === 'yes') await this.complete(block.id, true)
      else if (note) await this.putItem(block, { firstAction: resumeAction(note) })
      if (note && block.data.dumpId) await this.store.put(this.metaDoc({ ...this.meta(block.data.dumpId), resumeNote: note }))
    }
    return this.putPlan(day, {
      morningCheckAt: new Date().toISOString(),
      block1: result ? { result, stoppedAt: note } : null,
    })
  }

  async shutdown(day: string, input: { tomorrowFirst: string; foodSorted: boolean }): Promise<boolean> {
    const items = itemsForDay(this.docs, day)
    const plan: DayPlan = { ...this.dayPlan(day), shutdownAt: new Date().toISOString(), foodSorted: input.foodSorted, tomorrowFirst: input.tomorrowFirst.trim() }
    plan.blocksDone = blocksDone(items)
    plan.floorMet = floorMet(items, plan)
    return this.putPlan(day, plan, "Couldn't save the shutdown")
  }

  /** "Welcome back. No backlog." Old open items leave Today (they stay in the dump). */
  async restart(day: string, staleIds: string[]): Promise<boolean> {
    const at = new Date().toISOString()
    const writes = staleIds
      .map((id) => this.item(id))
      .filter((d): d is Doc<TodayItem> => !!d && d.data.status === 'open')
      .map((d) => ({ id: d.id, kind: KIND.todayItem, day: d.day, data: { ...d.data, status: 'skipped' as const, skips: [...d.data.skips, { at, reason: 'restart' as const, to: 'dump' as const }] } }))
    const ok = await this.store.put(writes)
    return ok && (await this.putPlan(day, { restartAt: at }))
  }

  /** Bring old open items into today instead of restarting. */
  bringBack(day: string, staleIds: string[]): Promise<boolean> {
    let order = orderAtEnd(itemsForDay(this.docs, day))
    const writes = staleIds
      .map((id) => this.item(id))
      .filter((d): d is Doc<TodayItem> => !!d && d.data.status === 'open')
      .map((d) => {
        order += 1024
        return { id: d.id, kind: KIND.todayItem, day, data: { ...d.data, carriedFrom: d.day, carryCount: d.data.carryCount + 1, order } }
      })
    return this.store.put(writes)
  }

  // ---- Tiles: repeat + bookmark ---------------------------------------------------------------

  tileMeta(dumpId: string): TileMeta {
    return this.meta(dumpId)
  }

  setTileMeta(dumpId: string, patch: Partial<Omit<TileMeta, 'dumpId'>>): Promise<boolean> {
    return this.store.put(this.metaDoc({ ...this.meta(dumpId), ...patch }), "Couldn't save the repeat setting")
  }

  // ---- Rules + settings ----------------------------------------------------------------------

  rules(): Array<Doc<Rule>> {
    return docsOfKind<Rule>(this.docs, KIND.rule).sort((a, b) => a.data.order - b.data.order || a.createdAt.localeCompare(b.createdAt))
  }

  /** Seed the starter if-then rules once per account. */
  async seedRules(): Promise<void> {
    const settings = this.settings()
    if (settings.rulesSeeded || this.store.getState().status !== 'ready') return
    const docs: PlannerDocInput[] = SEED_RULES.map((r, i) => ({
      id: newId(),
      kind: KIND.rule,
      day: null,
      data: { ...r, active: true, order: i * 1024 } satisfies Rule,
    }))
    if (this.rules().length === 0) await this.store.put(docs, "Couldn't add the starter rules")
    await this.updateSettings({ rulesSeeded: true })
  }

  saveRule(id: string | null, rule: Omit<Rule, 'order'> & { order?: number }): Promise<boolean> {
    const existing = id ? this.docs.get(id) : undefined
    const order = rule.order ?? (existing as Doc<Rule> | undefined)?.data.order ?? (Math.max(-1024, ...this.rules().map((r) => r.data.order)) + 1024)
    return this.store.put({ id: id ?? newId(), kind: KIND.rule, day: null, data: { ...rule, order } }, "Couldn't save the rule")
  }

  removeRule(id: string): Promise<boolean> {
    return this.store.remove(id, "Couldn't delete the rule")
  }

  updateSettings(patch: Partial<PlanSettings>): Promise<boolean> {
    return this.store.put({ id: settingsId(), kind: KIND.settings, day: null, data: { ...this.settings(), ...patch } }, "Couldn't save settings")
  }
}
