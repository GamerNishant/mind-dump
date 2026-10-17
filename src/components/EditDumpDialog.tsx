import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from 'lucide-react'
import { MAX_DUMP_LENGTH, type Dump } from '@/domain/dump'
import { daysBetween, formatDate, pendingLabel } from '@/lib/days'
import { Button, Modal } from './ui'

interface EditDumpDialogProps {
  dump: Dump | null
  now: Date
  onClose: () => void
  onSave: (id: string, content: string) => void
  onDelete: (dump: Dump) => void
  /** Non-drag alternative for reordering (single-pointer / assistive tech). */
  onMove?: (dump: Dump, edge: 'top' | 'bottom') => void
}

export function EditDumpDialog({ dump, now, onClose, onSave, onDelete, onMove }: EditDumpDialogProps) {
  const [value, setValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dumpId = dump?.id

  // Reset only when a different dump is opened (not when the same one re-renders).
  useEffect(() => {
    if (!dumpId) return
    setValue(dump?.content ?? '')
    setConfirmingDelete(false)
    // Focus after the dialog opens, caret at the end.
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dumpId])

  if (!dump) return <Modal open={false} onClose={onClose} title="Edit dump" />

  const days = daysBetween(dump.createdAt, now)
  const trimmed = value.trim()
  const save = () => {
    if (!trimmed) return
    onSave(dump.id, trimmed)
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
        confirmingDelete ? (
          <>
            <p className="mr-auto text-sm text-ink-muted">Delete this dump permanently?</p>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
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
        ) : (
          <>
            <Button variant="danger-ghost" className="mr-auto" onClick={() => setConfirmingDelete(true)}>
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
        rows={6}
        className="block max-h-[50dvh] min-h-32 w-full resize-y rounded-xl border border-line bg-card px-3.5 py-3 text-base leading-relaxed text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-[15px]"
      />
      {onMove && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (trimmed && trimmed !== dump.content) onSave(dump.id, trimmed)
              onMove(dump, 'top')
              onClose()
            }}
          >
            <ArrowUpToLine aria-hidden />
            Move to top
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (trimmed && trimmed !== dump.content) onSave(dump.id, trimmed)
              onMove(dump, 'bottom')
              onClose()
            }}
          >
            <ArrowDownToLine aria-hidden />
            Move to bottom
          </Button>
        </div>
      )}
    </Modal>
  )
}
