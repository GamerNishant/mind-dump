import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, History, RefreshCw, RotateCcw, Search, SearchX, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonClass, ConfirmDialog, EmptyState, focusRing } from '@/components/ui'
import type { Dump } from '@/domain/dump'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { preview } from '@/lib/text'
import { dayHeading, daysBetween, formatTime, localDayKey, pendingLabel } from '@/lib/days'
import { matchesQuery } from '@/lib/sort'
import { useDumpsState, useDumpsStore } from '@/state/DumpsProvider'

type Confirm = { kind: 'clear' } | { kind: 'delete'; dump: Dump } | null

export function HistoryPage() {
  const store = useDumpsStore()
  const { done, doneStatus, doneHasMore } = useDumpsState()
  const navigate = useNavigate()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    store.setHistoryOpen(true)
    return () => store.setHistoryOpen(false)
  }, [store])

  const groups = useMemo(() => {
    const result: Array<{ key: string; heading: string; items: Dump[] }> = []
    for (const dump of done) {
      if (!matchesQuery(dump, query)) continue
      const at = dump.completedAt ?? dump.updatedAt
      const key = localDayKey(at)
      const last = result.at(-1)
      if (last?.key === key) last.items.push(dump)
      else result.push({ key, heading: dayHeading(at, now), items: [dump] })
    }
    return result
  }, [done, query, now])

  const restore = (dump: Dump) => {
    void store.restore(dump, 'top').then(
      (ok) =>
        ok &&
        toast.success('Back on your board', {
          description: preview(dump.content),
          action: { label: 'View', onClick: () => navigate('/') },
        }),
    )
  }

  const loadMore = async () => {
    setLoadingMore(true)
    await store.loadMoreDone()
    setLoadingMore(false)
  }

  const loading = doneStatus === 'idle' || doneStatus === 'loading'
  const searching = query.trim() !== ''

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <div className="flex items-start gap-3">
        <Link to="/" className={buttonClass('ghost', 'icon', '-ml-2 shrink-0')} aria-label="Back to board">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Everything you've cleared. Restore anything back to your board.</p>
        </div>
        {done.length > 0 && (
          <Button variant="danger-ghost" size="sm" className="mt-1" onClick={() => setConfirm({ kind: 'clear' })}>
            <Trash2 aria-hidden />
            <span className="max-sm:sr-only">Clear all</span>
          </Button>
        )}
      </div>

      {done.length > 0 && (
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Search history"
            aria-label="Search history"
            className="h-10 w-full rounded-xl border border-line bg-card pr-9 pl-9 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
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
      )}

      <div className="mt-6">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading history">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-[4.5rem] animate-pulse rounded-xl border border-line bg-card" />
            ))}
          </div>
        ) : doneStatus === 'error' && done.length === 0 ? (
          <EmptyState
            icon={<RefreshCw />}
            title="Couldn't load history"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => void store.loadDone()}>
                Try again
              </Button>
            }
          />
        ) : done.length === 0 ? (
          <EmptyState
            icon={<History />}
            title="Nothing cleared yet"
            description="When you click a tile on your board it lands here, so you can always bring it back."
            action={
              <Link to="/" className={buttonClass('secondary')}>
                Go to board
              </Link>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState icon={<SearchX />} title="No matches" description={<>Nothing in loaded history matches “{query.trim()}”.</>} />
        ) : (
          <div className="space-y-7">
            {groups.map((group) => (
              <section key={group.key} aria-labelledby={`h-${group.key}`}>
                <h2 id={`h-${group.key}`} className="mb-2.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                  {group.heading}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((dump) => (
                    <HistoryItem
                      key={dump.id}
                      dump={dump}
                      onRestore={() => restore(dump)}
                      onDelete={() => setConfirm({ kind: 'delete', dump })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {doneHasMore && !loading && (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'clear'}
        title="Clear all history?"
        description="This permanently deletes every cleared dump. Pending dumps on your board stay untouched."
        confirmLabel="Delete all"
        onConfirm={() => void store.clearDone().then((ok) => ok && toast('History cleared'))}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title="Delete forever?"
        description={confirm?.kind === 'delete' ? <>“{preview(confirm.dump.content, 80)}” will be permanently deleted.</> : null}
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirm?.kind === 'delete') void store.remove(confirm.dump.id)
        }}
        onClose={() => setConfirm(null)}
      />
    </main>
  )
}

function HistoryItem({ dump, onRestore, onDelete }: { dump: Dump; onRestore: () => void; onDelete: () => void }) {
  const completedAt = dump.completedAt ?? dump.updatedAt
  const pendingDays = daysBetween(dump.createdAt, completedAt)
  return (
    <li className="animate-fade-up flex items-center gap-3 rounded-xl border border-line bg-card p-3 pl-4 shadow-xs">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-4 text-[15px] leading-snug break-words whitespace-pre-wrap text-ink">{dump.content}</p>
        <p className="mt-1 text-xs text-ink-subtle">
          Cleared {formatTime(completedAt)} ·{' '}
          {pendingDays === 0 ? 'same day it was added' : `was pending ${pendingLabel(pendingDays)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" onClick={onRestore} aria-label={`Restore: ${preview(dump.content)}`}>
          <RotateCcw aria-hidden />
          <span className="max-sm:hidden">Restore</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete forever: ${preview(dump.content)}`} className="hover:text-danger">
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  )
}
