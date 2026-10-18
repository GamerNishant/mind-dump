import type { Dump } from '@/domain/dump'
import { MAX_DUMP_LENGTH } from '@/domain/dump'
import { errorMessage } from '@/data/errors'
import type { DumpsApi } from '@/data/types'
import { newId } from '@/lib/id'
import { freePositionNear, planMove, POSITION_STEP, rebalance, topPosition, type PositionUpdate } from '@/lib/position'
import { byPosition } from '@/lib/sort'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface DumpsState {
  /** Pending dumps, always kept in "My order" (see byPosition). */
  active: Dump[]
  activeStatus: LoadStatus
  /** Completed dumps loaded so far, newest completion first. */
  done: Dump[]
  doneStatus: LoadStatus
  doneHasMore: boolean
}

export const HISTORY_PAGE_SIZE = 50

const initialState: DumpsState = {
  active: [],
  activeStatus: 'idle',
  done: [],
  doneStatus: 'idle',
  doneHasMore: false,
}

const byCompletedDesc = (a: Dump, b: Dump) => Date.parse(b.completedAt ?? '') - Date.parse(a.completedAt ?? '')
const withoutId = (list: Dump[], id: string) => list.filter((d) => d.id !== id)

function upsertSorted(list: Dump[], item: Dump, compare: (a: Dump, b: Dump) => number): Dump[] {
  return [...withoutId(list, item.id), item].sort(compare)
}

function applyPositions(list: Dump[], updates: PositionUpdate[]): Dump[] {
  const byId = new Map(updates.map((u) => [u.id, u.position]))
  return list.map((d) => (byId.has(d.id) ? { ...d, position: byId.get(d.id)! } : d)).sort(byPosition)
}

/**
 * Client-side source of truth for one user's dumps. Every mutation is applied optimistically,
 * sent to the backend, and rolled back with an error report if the backend rejects it.
 * Framework-agnostic; React subscribes through useSyncExternalStore.
 */
export class DumpsStore {
  private state: DumpsState = initialState
  private listeners = new Set<() => void>()
  /**
   * Bumped when a mutation starts *and* when it settles, so any fetch that overlapped a
   * mutation (and may have read pre-write data) is discarded and re-queued.
   */
  private version = 0
  private inflight = 0
  private refreshQueued = false
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private unwatch: (() => void) | null = null
  /** Whether the History screen is showing (only then do refreshes reload history). */
  private historyOpen = false
  /** Per-dump promise chains: requests touching the same dump reach the server in order. */
  private chains = new Map<string, Promise<unknown>>()
  private readonly api: DumpsApi
  private readonly reportError: (message: string) => void

  constructor(api: DumpsApi, reportError: (message: string) => void = () => {}) {
    this.api = api
    this.reportError = reportError
  }

  getState = (): DumpsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.unwatch) return
    void this.loadActive()
    this.unwatch = this.api.watch(() => this.scheduleRefresh())
  }

  stop(): void {
    this.unwatch?.()
    this.unwatch = null
    clearTimeout(this.refreshTimer)
  }

  /** Called by the History screen on mount/unmount. */
  setHistoryOpen(open: boolean): void {
    this.historyOpen = open
    if (open) void this.loadDone()
  }

  // ---- loading -------------------------------------------------------------

  async loadActive(): Promise<void> {
    if (this.state.activeStatus !== 'ready') this.setState({ activeStatus: 'loading' })
    const version = this.version
    try {
      const active = await this.api.listActive()
      if (version !== this.version || this.inflight > 0) return this.scheduleRefresh()
      this.setState({ active: [...active].sort(byPosition), activeStatus: 'ready' })
    } catch (error) {
      if (this.state.activeStatus !== 'ready') this.setState({ activeStatus: 'error' })
      this.reportError(`Couldn't load your dumps. ${errorMessage(error)}`)
    }
  }

  /** Loads the first page of history (or reloads what's already shown). */
  async loadDone(): Promise<void> {
    if (this.state.doneStatus !== 'ready') this.setState({ doneStatus: 'loading' })
    const limit = Math.max(HISTORY_PAGE_SIZE, this.state.done.length)
    const version = this.version
    try {
      const page = await this.api.listDone({ offset: 0, limit })
      if (version !== this.version || this.inflight > 0) return this.scheduleRefresh()
      this.setState({ done: page.items, doneHasMore: page.hasMore, doneStatus: 'ready' })
    } catch (error) {
      if (this.state.doneStatus !== 'ready') this.setState({ doneStatus: 'error' })
      this.reportError(`Couldn't load history. ${errorMessage(error)}`)
    }
  }

  async loadMoreDone(): Promise<void> {
    const offset = this.state.done.length
    try {
      const page = await this.api.listDone({ offset, limit: HISTORY_PAGE_SIZE })
      this.setState((s) => {
        const seen = new Set(s.done.map((d) => d.id))
        return { done: [...s.done, ...page.items.filter((d) => !seen.has(d.id))], doneHasMore: page.hasMore }
      })
    } catch (error) {
      this.reportError(`Couldn't load more history. ${errorMessage(error)}`)
    }
  }

  /** Re-sync with the backend (other tab/device changed something, or a write failed). */
  refresh(): void {
    void this.loadActive()
    if (this.historyOpen) void this.loadDone()
  }

  private scheduleRefresh(): void {
    if (this.inflight > 0) {
      this.refreshQueued = true
      return
    }
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      if (this.inflight > 0) {
        this.refreshQueued = true
        return
      }
      this.refreshQueued = false
      this.refresh()
    }, 300)
  }

  /** Top placement is computed from the board, so make sure it has loaded at least once. */
  private async ensureActiveLoaded(): Promise<boolean> {
    if (this.state.activeStatus !== 'ready') await this.loadActive()
    return this.state.activeStatus === 'ready'
  }

  // ---- mutations -----------------------------------------------------------

  /** Adds one dump per entry, in the given order, above everything else. */
  async add(contents: string[]): Promise<boolean> {
    return (await this.addMany(contents)) !== null
  }

  /** Like add(), but resolves to the new dumps (in the given order), or null if nothing was saved. */
  async addMany(contents: string[]): Promise<Dump[] | null> {
    const texts = contents.map((c) => c.trim().slice(0, MAX_DUMP_LENGTH)).filter(Boolean)
    if (texts.length === 0) return null
    // If the board couldn't load, a strictly decreasing time-based slot still lands on top.
    const loaded = await this.ensureActiveLoaded()
    const top = loaded ? topPosition(this.state.active) : -Date.now()
    const now = new Date().toISOString()
    const drafts: Dump[] = texts.map((content, i) => ({
      id: newId(),
      content,
      position: top - POSITION_STEP * (texts.length - 1 - i),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }))
    const ids = new Set(drafts.map((d) => d.id))

    const ok = await this.mutate({
      keys: [...ids],
      apply: () => this.setState((s) => ({ active: [...drafts, ...s.active].sort(byPosition) })),
      rollback: () => this.setState((s) => ({ active: s.active.filter((d) => !ids.has(d.id)) })),
      run: async () => {
        const saved = await this.api.create(drafts.map(({ id, content, position }) => ({ id, content, position })))
        const byId = new Map(saved.map((d) => [d.id, d]))
        // Adopt server timestamps without disturbing any local edits/reordering made since.
        this.setState((s) => ({
          active: s.active.map((d) => {
            const server = byId.get(d.id)
            return server ? { ...d, createdAt: server.createdAt, updatedAt: server.updatedAt } : d
          }),
        }))
      },
      error: texts.length > 1 ? "Couldn't save those dumps" : "Couldn't save that dump",
    })
    return ok ? drafts : null
  }

  /** Marks a dump done (moves it to history). Resolves to the dump as it was, for undo. */
  async complete(id: string): Promise<Dump | null> {
    const dump = this.state.active.find((d) => d.id === id)
    if (!dump) return null
    const completed: Dump = { ...dump, status: 'done', completedAt: new Date().toISOString() }
    const ok = await this.mutate({
      keys: [id],
      apply: () =>
        this.setState((s) => ({
          active: withoutId(s.active, id),
          done: s.doneStatus === 'ready' ? upsertSorted(s.done, completed, byCompletedDesc) : s.done,
        })),
      rollback: () =>
        this.setState((s) => ({ active: upsertSorted(s.active, dump, byPosition), done: withoutId(s.done, id) })),
      run: () => this.api.complete(id),
      error: "Couldn't clear that dump",
    })
    return ok ? dump : null
  }

  /** Puts a completed dump back on the board — at its old spot (undo) or on top (from history). */
  async restore(dump: Dump, placement: 'original' | 'top' = 'top'): Promise<boolean> {
    const loaded = await this.ensureActiveLoaded()
    const doneIndex = this.state.done.findIndex((d) => d.id === dump.id)
    const previous = doneIndex >= 0 ? this.state.done[doneIndex] : undefined
    const others = withoutId(this.state.active, dump.id)
    const position =
      placement === 'top' ? (loaded ? topPosition(others) : -Date.now()) : freePositionNear(others, dump.position)
    const restored: Dump = { ...dump, status: 'active', completedAt: null, position }

    return this.mutate({
      keys: [dump.id],
      apply: () =>
        this.setState((s) => ({ active: upsertSorted(s.active, restored, byPosition), done: withoutId(s.done, dump.id) })),
      rollback: () =>
        this.setState((s) => {
          const done = withoutId(s.done, dump.id)
          if (previous) done.splice(Math.min(doneIndex, done.length), 0, previous)
          return { active: withoutId(s.active, dump.id), done }
        }),
      run: () => this.api.restore(dump.id, position),
      error: "Couldn't restore that dump",
    })
  }

  async edit(id: string, content: string): Promise<boolean> {
    const text = content.trim().slice(0, MAX_DUMP_LENGTH)
    const current = this.state.active.find((d) => d.id === id) ?? this.state.done.find((d) => d.id === id)
    if (!text || !current) return false
    if (current.content === text) return true
    const oldContent = current.content
    const setContent = (list: Dump[], value: string) => list.map((d) => (d.id === id ? { ...d, content: value } : d))

    return this.mutate({
      keys: [id],
      apply: () => this.setState((s) => ({ active: setContent(s.active, text), done: setContent(s.done, text) })),
      rollback: () =>
        this.setState((s) => ({ active: setContent(s.active, oldContent), done: setContent(s.done, oldContent) })),
      run: () => this.api.updateContent(id, text),
      error: "Couldn't save your edit",
    })
  }

  /** Permanently deletes a dump (from the board or history). */
  async remove(id: string): Promise<boolean> {
    const activeItem = this.state.active.find((d) => d.id === id)
    const doneIndex = this.state.done.findIndex((d) => d.id === id)
    const doneItem = doneIndex >= 0 ? this.state.done[doneIndex] : undefined
    if (!activeItem && !doneItem) return false

    return this.mutate({
      keys: [id],
      apply: () => this.setState((s) => ({ active: withoutId(s.active, id), done: withoutId(s.done, id) })),
      rollback: () =>
        this.setState((s) => {
          const done = withoutId(s.done, id)
          if (doneItem) done.splice(Math.min(doneIndex, done.length), 0, doneItem)
          return { active: activeItem ? upsertSorted(s.active, activeItem, byPosition) : s.active, done }
        }),
      run: () => this.api.remove(id),
      error: "Couldn't delete that dump",
    })
  }

  async clearDone(): Promise<boolean> {
    const { done, doneHasMore } = this.state
    return this.mutate({
      // Wait for *every* outstanding request, not just loaded history: a restore still in
      // flight must land before the server-side "delete all done" runs.
      keys: [...new Set([...done.map((d) => d.id), ...this.chains.keys()])],
      apply: () => this.setState({ done: [], doneHasMore: false }),
      rollback: () => this.setState({ done, doneHasMore }),
      run: () => this.api.clearDone(),
      error: "Couldn't clear history",
    })
  }

  /**
   * Reorder in "My order". `orderedIds` is the order the user saw after the move; using it
   * (rather than recomputing indexes) guarantees the result matches what was on screen.
   */
  async moveTo(movedId: string, orderedIds: string[]): Promise<boolean> {
    const byId = new Map(this.state.active.map((d) => [d.id, d]))
    const next = orderedIds.map((id) => byId.get(id)).filter((d): d is Dump => !!d)
    const index = next.findIndex((d) => d.id === movedId)
    if (index < 0 || next.length !== this.state.active.length) return this.setOrder(orderedIds)
    return this.writeOrder(planMove(next, index))
  }

  /** Adopt an explicit order for all active dumps (e.g. after dragging in a sorted view). */
  async setOrder(orderedIds: string[]): Promise<boolean> {
    const byId = new Map(this.state.active.map((d) => [d.id, d]))
    const ordered = orderedIds.map((id) => byId.get(id)).filter((d): d is Dump => !!d)
    const listed = new Set(ordered.map((d) => d.id))
    // Anything missing from the given order keeps its relative place at the end.
    const rest = this.state.active.filter((d) => !listed.has(d.id))
    return this.writeOrder(rebalance([...ordered, ...rest]))
  }

  private writeOrder(updates: PositionUpdate[]): Promise<boolean> {
    const before = new Map(this.state.active.map((d) => [d.id, d.position]))
    const changed = updates.filter((u) => before.get(u.id) !== u.position)
    if (changed.length === 0) return Promise.resolve(true)
    const previous = changed.map((u) => ({ id: u.id, position: before.get(u.id)! }))
    return this.mutate({
      keys: changed.map((u) => u.id),
      apply: () => this.setState((s) => ({ active: applyPositions(s.active, changed) })),
      rollback: () => this.setState((s) => ({ active: applyPositions(s.active, previous) })),
      run: () => this.api.setPositions(changed),
      error: "Couldn't save the new order",
    })
  }

  // ---- internals -----------------------------------------------------------

  private async mutate(op: {
    keys: string[]
    apply: () => void
    rollback: () => void
    run: () => Promise<unknown>
    error: string
  }): Promise<boolean> {
    this.version++
    this.inflight++
    op.apply()
    const previous = Promise.all(op.keys.map((k) => this.chains.get(k)))
    const task = previous.then(op.run)
    const settled = task.catch(() => {})
    op.keys.forEach((k) => this.chains.set(k, settled))
    try {
      await task
      return true
    } catch (error) {
      op.rollback()
      // Later operations may have built on the optimistic state; let the server have the last word.
      this.refreshQueued = true
      this.reportError(`${op.error}. ${errorMessage(error)}`)
      return false
    } finally {
      op.keys.forEach((k) => {
        if (this.chains.get(k) === settled) this.chains.delete(k)
      })
      this.version++
      this.inflight--
      if (this.inflight === 0 && this.refreshQueued) this.scheduleRefresh()
    }
  }

  private setState(patch: Partial<DumpsState> | ((s: DumpsState) => Partial<DumpsState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...next }
    this.listeners.forEach((l) => l())
  }
}
