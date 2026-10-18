import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Split, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_DUMP_LENGTH, type Dump } from '@/domain/dump'
import { BLOCK_MINUTES, type ItemType, type TileMeta } from '@/domain/plan'
import { cn } from '@/lib/cn'
import { daysBetween, formatDate, pendingLabel } from '@/lib/days'
import { splitLines } from '@/lib/text'
import { useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, usePlannerState } from '@/state/PlannerProvider'
import { Button, focusRing, Modal, TextField } from './ui'

interface EditDumpDialogProps {
  dump: Dump | null
  now: Date
  onClose: () => void
  onSave: (id: string, content: string) => void
  /** `quiet`: the tile was replaced (Split into lines), so skip the "deleted" toast. */
  onDelete: (dump: Dump, opts?: { quiet?: boolean }) => void
  /** Non-drag alternative for reordering (single-pointer / assistive tech). */
  onMove?: (dump: Dump, edge: 'top' | 'bottom') => void
}

/** The tile's planner settings as edited in the dialog. */
interface MetaForm {
  repeat: number[]
  type: ItemType
  minutes: number
  habit: boolean
  minimum: string
  bookmark: string
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [1, 2, 3, 4, 5]
/** Monday-first display; values are Date#getDay numbers (0 = Sunday). */
const DAY_TOGGLES = [
  { value: 1, short: 'M', long: 'Monday' },
  { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' },
  { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' },
  { value: 6, short: 'S', long: 'Saturday' },
  { value: 0, short: 'S', long: 'Sunday' },
]

const sortedDays = (days: readonly number[] | null | undefined) => [...new Set(days ?? [])].sort((a, b) => a - b)
const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((d, i) => d === b[i])

function formOf(meta: TileMeta): MetaForm {
  return {
    repeat: sortedDays(meta.repeat),
    type: meta.defaultType,
    minutes: meta.defaultMinutes,
    habit: meta.habit,
    minimum: meta.defaultMinimum ?? '',
    bookmark: meta.resumeNote ?? '',
  }
}

/** Only the fields that changed, or null when nothing did. */
function metaPatch(initial: MetaForm, form: MetaForm): Partial<Omit<TileMeta, 'dumpId'>> | null {
  const patch: Partial<Omit<TileMeta, 'dumpId'>> = {}
  if (!sameDays(initial.repeat, form.repeat)) patch.repeat = form.repeat.length ? form.repeat : null
  if (initial.type !== form.type) patch.defaultType = form.type
  if (initial.minutes !== form.minutes) patch.defaultMinutes = form.minutes
  if (initial.habit !== form.habit) patch.habit = form.habit
  if (initial.minimum.trim() !== form.minimum.trim()) patch.defaultMinimum = form.minimum.trim()
  if (initial.bookmark.trim() !== form.bookmark.trim()) patch.resumeNote = form.bookmark.trim()
  return Object.keys(patch).length ? patch : null
}

export function EditDumpDialog({ dump, now, onClose, onSave, onDelete, onMove }: EditDumpDialogProps) {
  const planner = usePlanner()
  const { status: plannerStatus } = usePlannerState()
  const dumps = useDumpsStore()
  const plannerReady = plannerStatus === 'ready'
  const [value, setValue] = useState('')
  const [confirming, setConfirming] = useState<'delete' | 'split' | null>(null)
  const [splitting, setSplitting] = useState(false)
  const [form, setForm] = useState<MetaForm | null>(null)
  const initialForm = useRef<MetaForm | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dumpId = dump?.id

  // Reset only when a different dump is opened (not when the same one re-renders).
  useEffect(() => {
    if (!dumpId) return
    setValue(dump?.content ?? '')
    setConfirming(null)
    setSplitting(false)
    // Focus after the dialog opens, caret at the end.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dumpId])

  // Planner settings load per opened tile (and once the planner finishes loading).
  useEffect(() => {
    if (!dumpId || !plannerReady) {
      initialForm.current = null
      setForm(null)
      return
    }
    const initial = formOf(planner.tileMeta(dumpId))
    initialForm.current = initial
    setForm(initial)
  }, [dumpId, plannerReady, planner])

  if (!dump) return <Modal open={false} onClose={onClose} title="Edit dump" />

  const days = daysBetween(dump.createdAt, now)
  const trimmed = value.trim()
  const parts = splitLines(value)
  const canSplit = parts.length > 1

  const commitMeta = () => {
    if (!form || !initialForm.current || !plannerReady) return
    const patch = metaPatch(initialForm.current, form)
    if (patch) void planner.setTileMeta(dump.id, patch)
  }

  const save = () => {
    if (!trimmed) return
    onSave(dump.id, trimmed)
    commitMeta()
    onClose()
  }

  const move = (edge: 'top' | 'bottom') => {
    if (trimmed && trimmed !== dump.content) onSave(dump.id, trimmed)
    commitMeta()
    onMove?.(dump, edge)
    onClose()
  }

  const split = async () => {
    setSplitting(true)
    const created = await dumps.addMany(parts)
    setSplitting(false)
    if (!created) return // the dumps store already showed the error
    onDelete(dump, { quiet: true })
    // The original tile is gone: its open Today items close (reason "deleted").
    void planner.retireDump(dump.id)
    toast.success(`Split into ${created.length} tiles`)
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit dump"
      description={
        <>
          Added {formatDate(dump.createdAt, now)} · pending {days === 0 ? 'since today' : pendingLabel(days)}
        </>
      }
      footer={
        confirming === 'delete' ? (
          <>
            <p className="mr-auto text-sm text-ink-muted">Delete this dump permanently?</p>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep
            </Button>
            <Button
              variant="danger"
              autoFocus
              onClick={() => {
                onDelete(dump)
                onClose()
              }}
            >
              <Trash2 aria-hidden />
              Delete forever
            </Button>
          </>
        ) : confirming === 'split' ? (
          <>
            <p className="mr-auto text-sm text-ink-muted">
              Split into {parts.length} tiles? The original tile is replaced.
            </p>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={splitting}>
              Keep
            </Button>
            <Button autoFocus loading={splitting} onClick={() => void split()}>
              <Split aria-hidden />
              Split
            </Button>
          </>
        ) : (
          <>
            <Button variant="danger-ghost" className="mr-auto" onClick={() => setConfirming('delete')}>
              <Trash2 aria-hidden />
              Delete
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!trimmed}>
              Save
            </Button>
          </>
        )
      }
    >
      <label htmlFor="edit-dump" className="sr-only">
        Dump text
      </label>
      <textarea
        id="edit-dump"
        ref={textareaRef}
        value={value}
        maxLength={MAX_DUMP_LENGTH}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
        rows={5}
        className="block max-h-[50dvh] min-h-28 w-full resize-y rounded-xl border border-line bg-card px-3.5 py-3 text-base leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-[15px]"
      />
      {(onMove || canSplit) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onMove && (
            <>
              <Button variant="secondary" size="sm" onClick={() => move('top')}>
                <ArrowUpToLine aria-hidden />
                Move to top
              </Button>
              <Button variant="secondary" size="sm" onClick={() => move('bottom')}>
                <ArrowDownToLine aria-hidden />
                Move to bottom
              </Button>
            </>
          )}
          {canSplit && (
            <Button variant="secondary" size="sm" onClick={() => setConfirming('split')}>
              <Split aria-hidden />
              Split into lines
            </Button>
          )}
        </div>
      )}

      {plannerStatus === 'setup' ? null : plannerStatus === 'error' ? (
        <p className="mt-5 border-t border-line pt-4 text-xs text-ink-subtle">Planner unavailable: Repeat and Bookmark can't be edited right now.</p>
      ) : form ? (
        <PlanSettingsSection form={form} onChange={(patch) => setForm((f) => (f ? { ...f, ...patch } : f))} />
      ) : (
        <p className="mt-5 border-t border-line pt-4 text-xs text-ink-subtle">Loading Repeat and Bookmark…</p>
      )}
    </Modal>
  )
}

function PlanSettingsSection({ form, onChange }: { form: MetaForm; onChange: (patch: Partial<MetaForm>) => void }) {
  const id = useId()
  const repeatOff = form.repeat.length === 0
  const toggleDay = (day: number) =>
    onChange({ repeat: sortedDays(form.repeat.includes(day) ? form.repeat.filter((d) => d !== day) : [...form.repeat, day]) })

  return (
    <div className="mt-5 space-y-4 border-t border-line pt-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Repeat</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Repeat preset">
            <SegmentButton pressed={repeatOff} onClick={() => onChange({ repeat: [] })}>
              Off
            </SegmentButton>
            <SegmentButton pressed={sameDays(form.repeat, ALL_DAYS)} onClick={() => onChange({ repeat: ALL_DAYS })}>
              Daily
            </SegmentButton>
            <SegmentButton pressed={sameDays(form.repeat, WEEKDAYS)} onClick={() => onChange({ repeat: WEEKDAYS })}>
              Weekdays
            </SegmentButton>
          </Segmented>
        </div>
        <div role="group" aria-label="Repeat days" className="mt-2 flex flex-wrap gap-1.5">
          {DAY_TOGGLES.map((d) => {
            const on = form.repeat.includes(d.value)
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                aria-label={d.long}
                title={d.long}
                onClick={() => toggleDay(d.value)}
                className={cn(
                  'grid size-9 place-items-center rounded-full text-sm font-medium transition',
                  on ? 'bg-accent-solid text-accent-ink shadow-sm' : 'border border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink',
                  focusRing,
                )}
              >
                {d.short}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-ink-subtle">Repeating tiles add themselves to Today on these days.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">In Today, it's a</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Item type">
            <SegmentButton pressed={form.type === 'block'} onClick={() => onChange({ type: 'block' })}>
              Block
            </SegmentButton>
            <SegmentButton pressed={form.type === 'task'} onClick={() => onChange({ type: 'task' })}>
              Task
            </SegmentButton>
          </Segmented>
          {form.type === 'block' && (
            <Segmented label="Block length">
              {BLOCK_MINUTES.map((m) => (
                <SegmentButton key={m} pressed={form.minutes === m} onClick={() => onChange({ minutes: m })}>
                  {m} min
                </SegmentButton>
              ))}
            </Segmented>
          )}
        </div>
        <label htmlFor={`${id}-habit`} className="mt-3 flex cursor-pointer items-start gap-2.5">
          <input
            id={`${id}-habit`}
            type="checkbox"
            checked={form.habit}
            onChange={(e) => onChange({ habit: e.target.checked })}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent-solid"
          />
          <span className="text-sm text-ink">
            Habit <span className="text-ink-muted">(doesn't count toward the cap: meals, snacks)</span>
          </span>
        </label>
      </fieldset>

      <TextField
        label="Minimum"
        value={form.minimum}
        onChange={(e) => onChange({ minimum: e.target.value })}
        placeholder="e.g. 5 bullet notes"
        maxLength={120}
        hint="What counts on a bad day."
      />

      <TextField
        label="Bookmark"
        value={form.bookmark}
        onChange={(e) => onChange({ bookmark: e.target.value })}
        placeholder="Where you stopped, e.g. PSIR p.14"
        maxLength={200}
        hint="Becomes the first action next time."
        trailing={
          form.bookmark ? (
            <button
              type="button"
              onClick={() => onChange({ bookmark: '' })}
              aria-label="Clear bookmark"
              className={cn('grid size-9 place-items-center rounded-lg text-ink-subtle hover:text-ink', focusRing)}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : undefined
        }
      />
    </div>
  )
}

function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-xl bg-sunken p-1">
      {children}
    </div>
  )
}

function SegmentButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'h-9 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition sm:h-8',
        pressed ? 'bg-card text-ink shadow-sm ring-1 ring-line-strong' : 'text-ink-muted hover:text-ink',
        focusRing,
      )}
    >
      {children}
    </button>
  )
}
