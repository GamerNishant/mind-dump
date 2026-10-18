import type { PlannerDoc } from '@/domain/planner'
import { errorMessage, SetupRequiredError } from '@/data/errors'
import type { PlannerApi, PlannerDocInput } from '@/data/types'

/** `setup`: the cloud database doesn't have the planner table yet (migration not run). */
export type PlannerStatus = 'idle' | 'loading' | 'ready' | 'error' | 'setup'

export interface PlannerState {
  /** Every loaded document by id. Replaced (never mutated) on change, so it works as a memo key. */
  docs: ReadonlyMap<string, PlannerDoc>
  status: PlannerStatus
  /** Bumped by every successful load: "the docs were just read from the backend". */
  loadSeq: number
  /**
   * A refetch is pending (another device/tab may have changed data, or the app was woken up).
   * Writes computed from `docs` alone (the day rollover) wait until it has landed.
   */
  refreshing: boolean
}

const initialState: PlannerState = { docs: new Map(), status: 'idle', loadSeq: 0, refreshing: false }

/**
 * Client-side source of truth for one user's planner documents. Same model as DumpsStore:
 * optimistic apply → backend call → rollback + error report on failure, per-document request
 * ordering, and stale-read protection for refetches that overlap a write.
 */
export class PlannerStore {
  private state: PlannerState = initialState
  private listeners = new Set<() => void>()
  private version = 0
  private inflight = 0
  private refreshQueued = false
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private unwatch: (() => void) | null = null
  private chains = new Map<string, Promise<unknown>>()
  private readonly api: PlannerApi
  private readonly kinds: readonly string[]
  private readonly sinceDay: () => string
  private readonly reportError: (message: string) => void

  /**
   * @param kinds document kinds to load
   * @param sinceDay oldest day (YYYY-MM-DD) of dated documents to load; undated ones always load
   */
  constructor(api: PlannerApi, kinds: readonly string[], sinceDay: () => string, reportError: (message: string) => void = () => {}) {
    this.api = api
    this.kinds = kinds
    this.sinceDay = sinceDay
    this.reportError = reportError
  }

  getState = (): PlannerState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.unwatch) return
    void this.load()
    this.unwatch = this.api.watch(() => this.scheduleRefresh())
  }

  stop(): void {
    this.unwatch?.()
    this.unwatch = null
    clearTimeout(this.refreshTimer)
  }

  async load(): Promise<void> {
    if (this.state.status !== 'ready') this.setState({ status: 'loading' })
    const version = this.version
    try {
      const docs = await this.api.list({ kinds: this.kinds, sinceDay: this.sinceDay() })
      if (version !== this.version || this.inflight > 0) return this.scheduleRefresh()
      this.setState((s) => ({
        docs: new Map(docs.map((d) => [d.id, d])),
        status: 'ready',
        loadSeq: s.loadSeq + 1,
        refreshing: this.refreshQueued,
      }))
    } catch (error) {
      if (this.state.refreshing) this.setState({ refreshing: false })
      if (error instanceof SetupRequiredError) {
        this.setState({ status: 'setup' })
        return
      }
      if (this.state.status !== 'ready') this.setState({ status: 'error' })
      this.reportError(`Couldn't load your planner. ${errorMessage(error)}`)
    }
  }

  /** Insert or replace documents. Resolves to whether the backend accepted the write. */
  put(input: PlannerDocInput | PlannerDocInput[], error = "Couldn't save that"): Promise<boolean> {
    const list = Array.isArray(input) ? input : [input]
    if (list.length === 0) return Promise.resolve(true)
    const now = new Date().toISOString()
    const previous = new Map(list.map((d) => [d.id, this.state.docs.get(d.id)]))
    const next = list.map(
      (d): PlannerDoc => ({ ...d, createdAt: previous.get(d.id)?.createdAt ?? now, updatedAt: now }),
    )
    return this.mutate({
      keys: list.map((d) => d.id),
      apply: () => this.patchDocs((docs) => next.forEach((d) => docs.set(d.id, d))),
      rollback: () =>
        this.patchDocs((docs) =>
          previous.forEach((old, id) => (old ? docs.set(id, old) : docs.delete(id))),
        ),
      run: () => this.api.upsert(list.map(({ id, kind, day, data }) => ({ id, kind, day, data }))),
      error,
    })
  }

  /**
   * Create documents only where the id doesn't exist yet (locally or on the server). Used for
   * deterministic-id documents another device may have created first; a refresh afterwards
   * adopts whichever version the server kept.
   */
  async create(input: PlannerDocInput[], error = "Couldn't save that"): Promise<boolean> {
    const list = input.filter((d) => !this.state.docs.has(d.id))
    if (list.length === 0) return true
    const now = new Date().toISOString()
    const ok = await this.mutate({
      keys: list.map((d) => d.id),
      apply: () => this.patchDocs((docs) => list.forEach((d) => docs.set(d.id, { ...d, createdAt: now, updatedAt: now }))),
      rollback: () => this.patchDocs((docs) => list.forEach((d) => docs.delete(d.id))),
      run: () => this.api.insertMissing(list),
      error,
    })
    if (ok) this.scheduleRefresh()
    return ok
  }

  remove(ids: string | string[], error = "Couldn't delete that"): Promise<boolean> {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => this.state.docs.has(id))
    if (list.length === 0) return Promise.resolve(true)
    const previous = list.map((id) => this.state.docs.get(id)!)
    return this.mutate({
      keys: list,
      apply: () => this.patchDocs((docs) => list.forEach((id) => docs.delete(id))),
      rollback: () => this.patchDocs((docs) => previous.forEach((d) => docs.set(d.id, d))),
      run: () => this.api.remove(list),
      error,
    })
  }

  refresh(): void {
    void this.load()
  }

  // ---- internals -----------------------------------------------------------

  private scheduleRefresh(): void {
    if (!this.state.refreshing) this.setState({ refreshing: true })
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

  private patchDocs(change: (docs: Map<string, PlannerDoc>) => void): void {
    this.setState((s) => {
      const docs = new Map(s.docs)
      change(docs)
      return { docs }
    })
  }

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
      if (error instanceof SetupRequiredError) {
        this.setState({ status: 'setup' })
      } else {
        this.refreshQueued = true
        this.reportError(`${op.error}. ${errorMessage(error)}`)
      }
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

  private setState(patch: Partial<PlannerState> | ((s: PlannerState) => Partial<PlannerState>)): void {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...next }
    this.listeners.forEach((l) => l())
  }
}
