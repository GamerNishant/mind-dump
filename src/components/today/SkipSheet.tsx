import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Lightbulb, Minimize2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button, focusRing, Modal } from '@/components/ui'
import { SHRUNK_MINUTES, SKIP_REASON_LABEL, SKIP_REASONS, type SkipReason, type SkipTo, type TodayItem } from '@/domain/plan'
import { cn } from '@/lib/cn'
import type { Doc } from '@/lib/plan'
import { usePlanner, usePlannerState } from '@/state/PlannerProvider'

const DESTINATIONS: ReadonlyArray<{ value: SkipTo; label: string }> = [
  { value: 'later', label: 'Later today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'dump', label: 'Back to dump' },
]

const REASONS: ReadonlyArray<{ value: SkipReason; label: string }> = SKIP_REASONS.map((r) => ({ value: r, label: SKIP_REASON_LABEL[r] }))

// ---- ChoiceChips: a radio group rendered as chips (roving tabindex, arrow keys) -------------

interface ChoiceChipsProps<T extends string> {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (value: T) => void
  className?: string
}

export function ChoiceChips<T extends string>({ label, options, value, onChange, className }: ChoiceChipsProps<T>) {
  const labelId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selected = options.findIndex((o) => o.value === value)
  const tabStop = selected >= 0 ? selected : 0

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={className}>
      <p id={labelId} className="mb-2 text-xs font-medium text-ink-muted">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const checked = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'h-9 pointer-coarse:h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
                focusRing,
                checked
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-card text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- SkipSheet: Start, Shrink, Say ------------------------------------------------------------

interface SkipSheetProps {
  /** The item being skipped; null closes the sheet. */
  item: Doc<TodayItem> | null
  onClose: () => void
}

export function SkipSheet({ item, onClose }: SkipSheetProps) {
  const planner = usePlanner()
  // Subscribe so the matching rules stay live while the sheet is open.
  usePlannerState()
  const navigate = useNavigate()
  const [reason, setReason] = useState<SkipReason | null>(null)
  const [to, setTo] = useState<SkipTo | null>(null)
  const [busy, setBusy] = useState<'start' | 'shrink' | 'skip' | null>(null)
  const itemId = item?.id

  // Fresh choices for each item opened.
  useEffect(() => {
    setReason(null)
    setTo(null)
    setBusy(null)
  }, [itemId])

  if (!item) return <Modal open={false} onClose={onClose} title="Not feeling it?" />

  const isBlock = item.data.type === 'block'
  const minimum = item.data.minimum.trim()
  const rules = reason ? planner.rules().filter((r) => r.data.active && r.data.reason === reason) : []

  const begin = async (mode: 'starter' | 'shrink') => {
    const running = planner.running()
    if (running && running.data.itemId !== item.id) {
      toast('A block is already running', { description: 'Finish or end it first.' })
      onClose()
      navigate('/focus')
      return
    }
    setBusy(mode === 'starter' ? 'start' : 'shrink')
    const id = await planner.startFocus(item.id, mode)
    setBusy(null)
    if (!id) return
    onClose()
    navigate('/focus')
  }

  const skip = async () => {
    if (!reason || !to) return
    setBusy('skip')
    const ok = await planner.skip(item.id, reason, to)
    setBusy(null)
    if (!ok) return
    const dest = DESTINATIONS.find((d) => d.value === to)!.label
    toast(`Skipped: ${SKIP_REASON_LABEL[reason]} → ${dest}`, {
      description: item.data.title,
      action: to === 'dump' ? { label: 'Undo', onClick: () => void planner.reopen(item.id) } : undefined,
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Not feeling it?" description={<span className="line-clamp-2">{item.data.title}</span>}>
      <div className="space-y-5">
        {/* 1. START */}
        <section aria-labelledby="skip-start" className="space-y-2">
          <h3 id="skip-start" className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            1 · Start
          </h3>
          <Button size="lg" className="h-12 w-full text-base" loading={busy === 'start'} disabled={!!busy} onClick={() => void begin('starter')} autoFocus>
            <Play aria-hidden />
            Do just 2 minutes
          </Button>
          <p className="text-sm text-ink-muted">Only the first action. You can stop after 2 minutes.</p>
          {item.data.firstAction.trim() && (
            <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
              <span className="text-ink-subtle">First action: </span>
              {item.data.firstAction}
            </p>
          )}
        </section>

        {/* 2. SHRINK (blocks only) */}
        {isBlock && (
          <section aria-labelledby="skip-shrink" className="space-y-2 border-t border-line pt-5">
            <h3 id="skip-shrink" className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              2 · Shrink
            </h3>
            <Button variant="secondary" size="lg" className="w-full" loading={busy === 'shrink'} disabled={!!busy} onClick={() => void begin('shrink')}>
              <Minimize2 aria-hidden />
              Shrink to {SHRUNK_MINUTES} min
            </Button>
            <p className="text-sm text-ink-muted">
              {minimum ? (
                <>
                  Just the minimum: <span className="font-medium text-ink">{minimum}</span>
                </>
              ) : (
                'One heading, three bullets. A shrunk block still counts as started.'
              )}
            </p>
          </section>
        )}

        {/* 3. SAY */}
        <section aria-labelledby="skip-say" className="space-y-4 border-t border-line pt-5">
          <div>
            <h3 id="skip-say" className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
              {isBlock ? '3' : '2'} · Say
            </h3>
            <p className="mt-1 text-sm font-medium text-ink">Skip it, on the record</p>
          </div>
          <ChoiceChips label="Why?" options={REASONS} value={reason} onChange={setReason} />
          {rules.length > 0 && (
            <div className="space-y-2" aria-live="polite">
              {rules.map((r) => (
                <div key={r.id} className="flex gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-ink">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <p className="min-w-0 break-words">
                    <span className="font-semibold text-accent">IF</span> {r.data.ifText}{' '}
                    <span className="font-semibold text-accent">THEN</span> {r.data.thenText}
                  </p>
                </div>
              ))}
            </div>
          )}
          <ChoiceChips label="Where does it go?" options={DESTINATIONS} value={to} onChange={setTo} />
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={!reason || !to || (!!busy && busy !== 'skip')} loading={busy === 'skip'} onClick={() => void skip()}>
              Skip
            </Button>
          </div>
          {(!reason || !to) && <p className="text-right text-xs text-ink-subtle">Pick a reason and a place to skip.</p>}
        </section>
      </div>
    </Modal>
  )
}
