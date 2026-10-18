import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Bookmark, Inbox, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button, focusRing, Modal } from '@/components/ui'
import type { Dump } from '@/domain/dump'
import type { ItemType } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { hasRoomFor } from '@/lib/plan'
import { matchesQuery } from '@/lib/sort'
import { preview } from '@/lib/text'
import { useDumpsState, useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'
import type { AddResult } from '@/state/planner'

const FULL = 'Today is full: finish, skip or remove one first'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Type a new Today item (also creates its tile), or pick one from the dump. */
export function AddItemForm({ view }: { view: TodayView }) {
  const planner = usePlanner()
  const dumps = useDumpsStore()
  const [text, setText] = useState('')
  const [type, setType] = useState<ItemType>('task')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const blocksLeft = Math.max(0, view.settings.blockCap - view.usage.blocks)
  const tasksLeft = Math.max(0, view.settings.taskCap - view.usage.tasks)

  /** `createdTile`: the add also created a new dump tile (typed items), so Undo removes that too. */
  const announce = (result: AddResult, title: string, createdTile = false) => {
    if (result.ok) {
      const undo = async () => {
        const removed = await planner.removeItem(result.id)
        if (removed && createdTile && result.dumpId) await dumps.remove(result.dumpId)
      }
      toast.success('Added to Today', {
        description: preview(title),
        action: { label: 'Undo', onClick: () => void undo() },
      })
    } else if (result.reason === 'full') {
      toast(FULL)
    } else if (result.reason === 'exists') {
      toast('Already in Today', { description: preview(title) })
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    if (!hasRoomFor(type, view.items, view.settings)) {
      toast(FULL)
      return
    }
    setBusy(true)
    const result = await planner.addText(value, type)
    setBusy(false)
    announce(result, value, true)
    if (result.ok) {
      setText('')
      inputRef.current?.focus()
    }
  }

  return (
    <section aria-labelledby="add-heading">
      <h2 id="add-heading" className="sr-only">
        Add to Today
      </h2>
      <form onSubmit={(e) => void submit(e)} className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Add to Today…"
          aria-label="Add to Today"
          aria-describedby="add-capacity"
          className="h-11 min-w-0 flex-1 basis-full rounded-xl border border-line bg-card px-3.5 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:basis-0 sm:text-sm"
        />
        <div role="group" aria-label="Type" className="inline-flex h-11 shrink-0 rounded-xl border border-line bg-card p-1">
          {(['task', 'block'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => setType(t)}
              className={cn(
                'rounded-lg px-3 text-sm font-medium transition',
                focusRing,
                type === t ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
              )}
            >
              {t === 'task' ? 'Task' : 'Block'}
            </button>
          ))}
        </div>
        <Button type="submit" size="lg" loading={busy} disabled={!text.trim()} className="flex-1 sm:flex-none">
          {!busy && <Plus aria-hidden />}
          Add
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p id="add-capacity" className="text-xs text-ink-subtle">
          Room left: {plural(blocksLeft, 'block')} · {plural(tasksLeft, 'task')}{' '}
          <span className="text-ink-subtle">
            (max {view.settings.blockCap} · {view.settings.taskCap})
          </span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => setPicking(true)} className="ml-auto h-10">
          <Inbox aria-hidden />
          Pick from dump
        </Button>
      </div>

      <DumpPicker view={view} open={picking} onClose={() => setPicking(false)} onAdded={announce} />
    </section>
  )
}

function DumpPicker({
  view,
  open,
  onClose,
  onAdded,
}: {
  view: TodayView
  open: boolean
  onClose: () => void
  onAdded: (result: AddResult, title: string) => void
}) {
  const planner = usePlanner()
  const { active, activeStatus } = useDumpsState()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const list = active.filter((d) => !view.inToday.has(d.id) && matchesQuery(d, query))
    const hasMark = (d: Dump) => (view.metas.get(d.id)?.resumeNote.trim() ? 0 : 1)
    // Stable sort: Bookmarked tiles first, otherwise board order.
    return list.map((d, i) => ({ d, i })).sort((a, b) => hasMark(a.d) - hasMark(b.d) || a.i - b.i).map(({ d }) => d)
  }, [active, view.inToday, view.metas, query])

  const pick = async (dump: Dump) => {
    if (pending) return
    setPending(dump.id)
    const result = await planner.addFromDump(dump)
    setPending(null)
    onAdded(result, dump.content)
  }

  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Pick from your dump"
      description="Tap a tile to queue it. It stays on the board."
      footer={
        <Button variant="secondary" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dumps"
          aria-label="Search dumps"
          className="h-11 w-full rounded-xl border border-line bg-card pr-3 pl-9 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {activeStatus === 'loading' || activeStatus === 'idle' ? (
        <p className="py-8 text-center text-sm text-ink-muted" role="status">
          Loading your dump…
        </p>
      ) : candidates.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          {query.trim() ? <>Nothing matches “{query.trim()}”.</> : 'Every tile on the board is already in Today.'}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5" aria-label="Dumps not in Today">
          {candidates.map((dump) => {
            const meta = view.metas.get(dump.id)
            const note = meta?.resumeNote.trim()
            return (
              <li key={dump.id}>
                <button
                  type="button"
                  onClick={() => void pick(dump)}
                  disabled={pending === dump.id}
                  aria-label={`Add to Today: ${preview(dump.content, 100)}`}
                  className={cn(
                    'flex min-h-12 w-full items-start gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left transition hover:border-line-strong hover:bg-sunken disabled:opacity-50',
                    focusRing,
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[15px] leading-snug break-words text-ink">{dump.content}</span>
                    {note && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-accent">
                        <Bookmark className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">Bookmark: {note}</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Plus className="size-4" aria-hidden />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
