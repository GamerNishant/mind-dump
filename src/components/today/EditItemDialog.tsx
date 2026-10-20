import { useEffect, useState } from 'react'
import { Archive, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { SegmentButton, Segmented } from '@/components/DayPicker'
import { PriorityFlag } from '@/components/PriorityFlag'
import { Button, Modal, TextField } from '@/components/ui'
import { BLOCK_MINUTES, PRIORITIES, PRIORITY_LABEL, type ItemType, type Priority, type TodayItem } from '@/domain/plan'
import type { Doc } from '@/lib/plan'
import { preview } from '@/lib/text'
import { useDumpsState, useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, type TodayView } from '@/state/PlannerProvider'

interface Form {
  title: string
  priority: Priority | null
  type: ItemType
  minutes: number
  firstAction: string
  minimum: string
}

/**
 * Edit a queue item in one place (name, priority, Block/Task, length, first action, minimum),
 * or take it off Today when it no longer matters, optionally clearing its tile too.
 */
export function EditItemDialog({ item, view, onClose }: { item: Doc<TodayItem> | null; view: TodayView; onClose: () => void }) {
  const planner = usePlanner()
  const dumps = useDumpsStore()
  const { active } = useDumpsState()
  const [form, setForm] = useState<Form | null>(null)
  const [removing, setRemoving] = useState(false)
  const itemId = item?.id

  useEffect(() => {
    if (!item) return
    const { data } = item
    setForm({
      title: data.title,
      priority: data.dumpId ? (view.metas.get(data.dumpId)?.priority ?? null) : null,
      type: data.type,
      minutes: data.minutes,
      firstAction: data.firstAction,
      minimum: data.minimum,
    })
    setRemoving(false)
    // Reset only when a different item opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  if (!item || !form) return <Modal open={false} onClose={onClose} title="Edit item" />

  const { data } = item
  const tile = data.dumpId ? active.find((d) => d.id === data.dumpId) : undefined
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const minuteOptions: number[] = BLOCK_MINUTES.includes(form.minutes as (typeof BLOCK_MINUTES)[number]) ? [...BLOCK_MINUTES] : [form.minutes, ...BLOCK_MINUTES]

  const save = async () => {
    if (!form.title.trim()) return
    onClose()
    if (form.title.trim() !== data.title) await planner.retitle(item.id, form.title)
    const text: Parameters<typeof planner.updateItem>[1] = {}
    if (form.firstAction.trim() !== data.firstAction) text.firstAction = form.firstAction.trim()
    if (form.minimum.trim() !== data.minimum) text.minimum = form.minimum.trim()
    if (Object.keys(text).length) await planner.updateItem(item.id, text)
    // Kind last and on its own: a refused switch to Block (cap) mustn't drop the other edits.
    const kind: Parameters<typeof planner.updateItem>[1] = {}
    if (form.type !== data.type) kind.type = form.type
    if (form.type === 'block' && form.minutes !== data.minutes) kind.minutes = form.minutes
    if (Object.keys(kind).length && !(await planner.updateItem(item.id, kind))) {
      toast(`Today is full: the block cap is ${view.settings.blockCap}`, { description: 'Kept it as a task.' })
    }
    const oldPriority = data.dumpId ? (view.metas.get(data.dumpId)?.priority ?? null) : null
    if (data.dumpId && form.priority !== oldPriority) await planner.setTileMeta(data.dumpId, { priority: form.priority })
  }

  const remove = async (clearTile: boolean) => {
    const snapshot = item
    const tileSnapshot = tile
    onClose()
    const result = await planner.dismiss(snapshot.id, { clearTile })
    if (!result) return
    toast.success(result.tileCleared ? 'Removed and tile cleared' : 'Removed from Today', {
      description: preview(snapshot.data.title),
      action: {
        label: 'Undo',
        onClick: () => {
          void planner.reopen(snapshot.id)
          if (result.tileCleared && tileSnapshot) void dumps.restore(tileSnapshot, 'original')
        },
      },
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit item"
      footer={
        removing ? null : (
          <>
            <Button variant="danger-ghost" className="mr-auto" onClick={() => setRemoving(true)}>
              <Trash2 aria-hidden />
              Remove
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!form.title.trim()}>
              Save
            </Button>
          </>
        )
      }
    >
      {removing ? (
        <div className="animate-fade-up">
          <p className="text-sm text-ink">
            Not relevant any more? Take <span className="font-semibold">“{preview(data.title, 60)}”</span> off Today. You can undo it, and it stays
            listed under Done &amp; skipped.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="secondary" size="lg" className="justify-start" onClick={() => void remove(false)} autoFocus>
              <X aria-hidden />
              Just remove it from Today
              <span className="ml-auto text-xs font-normal text-ink-subtle">{tile ? 'tile stays on the board' : ''}</span>
            </Button>
            {tile && (
              <Button variant="secondary" size="lg" className="justify-start" onClick={() => void remove(true)}>
                <Archive aria-hidden />
                Remove and clear the tile
                <span className="ml-auto text-xs font-normal text-ink-subtle">moves to History</span>
              </Button>
            )}
            <Button variant="ghost" onClick={() => setRemoving(false)} className="self-end">
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <TextField
            label="Name"
            value={form.title}
            maxLength={300}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            hint={tile ? 'Renames the tile on your board too.' : undefined}
          />

          {data.dumpId && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink">Priority</legend>
              <Segmented label="Priority">
                <SegmentButton pressed={form.priority === null} onClick={() => set({ priority: null })}>
                  None
                </SegmentButton>
                {PRIORITIES.map((p) => (
                  <SegmentButton key={p} pressed={form.priority === p} onClick={() => set({ priority: p })}>
                    <span className="inline-flex items-center gap-1">
                      <PriorityFlag priority={p} />
                      {PRIORITY_LABEL[p]}
                    </span>
                  </SegmentButton>
                ))}
              </Segmented>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Kind</legend>
            <div className="flex flex-wrap gap-2">
              <Segmented label="Kind">
                <SegmentButton pressed={form.type === 'task'} onClick={() => set({ type: 'task' })}>
                  Task
                </SegmentButton>
                <SegmentButton pressed={form.type === 'block'} onClick={() => set({ type: 'block' })}>
                  Focus block
                </SegmentButton>
              </Segmented>
              {form.type === 'block' && (
                <Segmented label="Block length">
                  {minuteOptions.map((m) => (
                    <SegmentButton key={m} pressed={form.minutes === m} onClick={() => set({ minutes: m })}>
                      {m} min
                    </SegmentButton>
                  ))}
                </Segmented>
              )}
            </div>
          </fieldset>

          <TextField
            label="First action"
            value={form.firstAction}
            maxLength={140}
            onChange={(e) => set({ firstAction: e.target.value })}
            placeholder="One physical first step"
          />
          <TextField
            label="Minimum"
            value={form.minimum}
            maxLength={140}
            onChange={(e) => set({ minimum: e.target.value })}
            placeholder="What counts on a bad day"
          />
        </div>
      )}
    </Modal>
  )
}
