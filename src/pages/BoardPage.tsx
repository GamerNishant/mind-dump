import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, ChevronDown, RefreshCw, Search, SearchX, Sparkles, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useUser } from '@/auth/AuthProvider'
import { Composer } from '@/components/Composer'
import { DumpGrid } from '@/components/DumpGrid'
import { EditDumpDialog } from '@/components/EditDumpDialog'
import { Button, EmptyState, focusRing } from '@/components/ui'
import type { Dump } from '@/domain/dump'
import { useNow } from '@/hooks/useNow'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/cn'
import { DEFAULT_SORT, isSortMode, matchesQuery, SORT_OPTIONS, sortDumps, type SortMode } from '@/lib/sort'
import { preview } from '@/lib/text'
import { useDumpsState, useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, useToday } from '@/state/PlannerProvider'

const EXIT_MS = 220

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function BoardPage() {
  const user = useUser()
  const store = useDumpsStore()
  const { active, activeStatus } = useDumpsState()
  const now = useNow()
  const [sort, setSort] = usePersistentState<SortMode>(`minddump:sort:${user.id}`, DEFAULT_SORT, isSortMode)
  const [query, setQuery] = useState('')
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set())
  const exitingRef = useRef(exiting)
  exitingRef.current = exiting
  // Track the dump being edited by id so the dialog always shows live data.
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = editingId ? (active.find((d) => d.id === editingId) ?? null) : null
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const planner = usePlanner()
  const { inToday, metas } = useToday()
  const navigate = useNavigate()
  const location = useLocation()
  // Today's "Too big? Split it" links here with the tile to open.
  const editDumpId = (location.state as { editDumpId?: unknown } | null)?.editDumpId

  const searching = query.trim() !== ''
  const sorted = useMemo(() => sortDumps(active, sort), [active, sort])
  const visible = useMemo(() => sorted.filter((d) => matchesQuery(d, query)), [sorted, query])
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // If the dump being edited disappears (e.g. cleared on another device), close the dialog.
  useEffect(() => {
    if (editingId && activeStatus === 'ready' && !active.some((d) => d.id === editingId)) {
      setEditingId(null)
    }
  }, [active, activeStatus, editingId])

  // Open the requested tile's editor once the board has loaded, then clear the request
  // so a reload or Back doesn't reopen it.
  const handledEditId = useRef<string | null>(null)
  useEffect(() => {
    if (typeof editDumpId !== 'string') {
      handledEditId.current = null
      return
    }
    if (handledEditId.current === editDumpId || activeStatus === 'idle' || activeStatus === 'loading') return
    handledEditId.current = editDumpId
    if (active.some((d) => d.id === editDumpId)) setEditingId(editDumpId)
    else toast("That tile isn't on the board any more")
    void navigate(location.pathname, { replace: true, state: null })
  }, [editDumpId, active, activeStatus, navigate, location.pathname])

  // "n" or "/" jumps to the composer from anywhere on the board.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if (document.querySelector('dialog[open]')) return
      if (e.key === 'n' || e.key === '/') {
        e.preventDefault()
        composerRef.current?.focus()
        composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Call before removing a tile. If keyboard focus was on that tile (or in the dialog acting on it),
   * the returned function moves focus to its neighbour — or the composer — once it's gone.
   */
  const focusAfterRemoval = useCallback((id: string) => {
    const focusedTile = document.activeElement?.closest('[data-dump-id]')?.getAttribute('data-dump-id')
    const fromDialog = !!document.querySelector('dialog[open]')
    if (focusedTile !== id && !fromDialog) return () => {}
    const list = visibleRef.current
    const index = list.findIndex((d) => d.id === id)
    const neighbour = list[index + 1] ?? list[index - 1]
    return () =>
      requestAnimationFrame(() => {
        const target = neighbour
          ? document.querySelector<HTMLButtonElement>(`[data-dump-id="${neighbour.id}"] button[aria-label^="Mark done"]`)
          : null
        ;(target ?? composerRef.current)?.focus({ preventScroll: !!target })
      })
  }, [])

  const complete = useCallback(
    (dump: Dump) => {
      if (exitingRef.current.has(dump.id)) return
      const restoreFocus = focusAfterRemoval(dump.id)
      setExiting((s) => new Set(s).add(dump.id))
      window.setTimeout(
        () => {
          setExiting((s) => {
            const next = new Set(s)
            next.delete(dump.id)
            return next
          })
          const toastId = toast.success('Cleared from your mind', {
            description: preview(dump.content),
            action: { label: 'Undo', onClick: () => void store.restore(dump, 'original') },
          })
          void store.complete(dump.id).then((result) => {
            if (!result) toast.dismiss(toastId)
          })
          restoreFocus()
        },
        prefersReducedMotion() ? 0 : EXIT_MS,
      )
    },
    [store, focusAfterRemoval],
  )

  const reorder = useCallback(
    (movedId: string, orderedIds: string[]) => {
      if (sort === 'custom') {
        void store.moveTo(movedId, orderedIds)
        return
      }
      void store.setOrder(orderedIds)
      setSort('custom')
      toast('Switched to “My order”', { description: 'Your move set a custom order. Pick a sort any time.' })
    },
    [sort, store, setSort],
  )

  const remove = useCallback(
    (dump: Dump, opts?: { quiet?: boolean }) => {
      const restoreFocus = focusAfterRemoval(dump.id)
      void store
        .remove(dump.id)
        .then((ok) => ok && !opts?.quiet && toast('Dump deleted', { description: preview(dump.content) }))
      restoreFocus()
    },
    [store, focusAfterRemoval],
  )

  const moveToEdge = useCallback(
    (dump: Dump, edge: 'top' | 'bottom') => {
      const rest = sorted.map((d) => d.id).filter((id) => id !== dump.id)
      reorder(dump.id, edge === 'top' ? [dump.id, ...rest] : [...rest, dump.id])
    },
    [sorted, reorder],
  )

  const openEditor = useCallback((dump: Dump) => setEditingId(dump.id), [])

  const addToday = useCallback(
    async (dump: Dump) => {
      const openToday = { label: 'Open Today', onClick: () => void navigate('/today') }
      const { status } = planner.store.getState()
      if (status === 'setup') {
        toast('Today needs a one-time setup', { description: 'Open Today to finish it.', action: openToday })
        return
      }
      if (status !== 'ready') {
        toast(status === 'error' ? "Today couldn't load" : 'Today is still loading', {
          description: 'Try again in a moment.',
          action: openToday,
        })
        return
      }
      const description = preview(dump.content)
      const result = await planner.addFromDump(dump)
      if (result.ok) {
        toast.success('Added to Today', {
          description,
          action: { label: 'Undo', onClick: () => void planner.removeItem(result.id) },
        })
      } else if (result.reason === 'exists') {
        toast('Already in Today', { description, action: openToday })
      } else if (result.reason === 'full') {
        toast.error('Today is full: finish, skip or remove one first', { description, action: openToday })
      }
      // 'error': the planner store already showed an error toast.
    },
    [planner, navigate],
  )

  const loading = activeStatus === 'idle' || activeStatus === 'loading'

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <section aria-label="Add a dump" className="mx-auto max-w-2xl">
        <Composer inputRef={composerRef} onSubmit={(items) => store.add(items)} />
      </section>

      <section aria-labelledby="board-heading" className="mt-8 sm:mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <h1 id="board-heading" className="text-lg font-semibold tracking-tight">
              Pending
            </h1>
            <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-muted tabular-nums">
              <span aria-hidden>{active.length}</span>
              <span className="sr-only">{active.length} pending</span>
            </span>
          </div>

          <div className="flex flex-wrap gap-2 sm:ml-auto sm:flex-nowrap">
            <div className="relative min-w-0 flex-1 basis-full min-[380px]:basis-0 sm:w-64 sm:flex-none sm:basis-auto">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder="Search dumps"
                aria-label="Search dumps"
                className={cn(
                  'h-10 w-full rounded-xl border border-line bg-card pl-9 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm [&::-webkit-search-cancel-button]:hidden',
                  searching ? 'pr-9' : 'pr-3',
                )}
              />
              {searching && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className={cn('absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-ink-subtle hover:text-ink', focusRing)}
                  aria-label="Clear search"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>

            <div className="relative shrink-0 max-[379px]:flex-1">
              <ArrowUpDown className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
              <select
                value={sort}
                onChange={(e) => isSortMode(e.target.value) && setSort(e.target.value)}
                aria-label="Sort dumps"
                className="h-10 w-full cursor-pointer appearance-none truncate rounded-xl border border-line bg-card pr-8 pl-9 text-base font-medium text-ink shadow-xs transition hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 min-[380px]:max-w-[10.5rem] sm:max-w-none sm:text-sm"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            </div>
          </div>
        </div>

        {active.length > 0 && (
          <p className="mt-3 text-xs text-ink-subtle">
            {searching ? (
              <>
                Showing {visible.length} of {active.length} · clear the search to reorder
              </>
            ) : (
              <>
                <span className="pointer-coarse:hidden">Click a tile when it's done · drag to reorder</span>
                <span className="hidden pointer-coarse:inline">Tap a tile when it's done · press and hold to reorder</span>
                {sort !== 'custom' && ' · reordering switches to “My order”'}
              </>
            )}
          </p>
        )}

        <div className="mt-4">
          {loading ? (
            <SkeletonGrid />
          ) : activeStatus === 'error' && active.length === 0 ? (
            <EmptyState
              icon={<RefreshCw />}
              title="Couldn't load your dumps"
              description="Check your connection and try again."
              action={
                <Button variant="secondary" onClick={() => void store.loadActive()}>
                  Try again
                </Button>
              }
            />
          ) : active.length === 0 ? (
            <EmptyState
              icon={<Sparkles />}
              title="Your mind is clear"
              description="Dump whatever's on your mind above — one thought per tile. Click a tile once it's handled."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<SearchX />}
              title="No matches"
              description={<>Nothing pending matches “{query.trim()}”.</>}
              action={
                <Button variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <DumpGrid
              dumps={visible}
              now={now}
              dragDisabled={searching}
              exitingIds={exiting}
              onComplete={complete}
              onEdit={openEditor}
              onReorder={reorder}
              inTodayIds={inToday}
              metas={metas}
              onAddToday={addToday}
            />
          )}
        </div>
      </section>

      <EditDumpDialog
        dump={editing}
        now={now}
        onClose={() => setEditingId(null)}
        onSave={(id, content) => void store.edit(id, content)}
        onDelete={remove}
        onMove={active.length > 1 ? moveToEdge : undefined}
      />
    </main>
  )
}

function SkeletonGrid() {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] sm:gap-4"
      role="status"
      aria-label="Loading dumps"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-[7.5rem] animate-pulse rounded-2xl border border-line bg-card p-4 sm:h-[8.5rem]">
          <div className="h-3 w-4/5 rounded bg-sunken" />
          <div className="mt-2 h-3 w-3/5 rounded bg-sunken" />
          <div className="mt-8 h-4 w-14 rounded-full bg-sunken" />
        </div>
      ))}
    </div>
  )
}
