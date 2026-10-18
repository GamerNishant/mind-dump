import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowLeft, ArrowUp, Minus, Pencil, Plus, RefreshCw, Trash2, Waypoints } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonClass, ConfirmDialog, EmptyState, focusRing, Modal } from '@/components/ui'
import { MAX_BLOCK_CAP, SKIP_REASON_LABEL, SKIP_REASONS, type Rule, type SkipReason } from '@/domain/plan'
import { cn } from '@/lib/cn'
import type { Doc } from '@/lib/plan'
import { usePlanner, usePlannerState } from '@/state/PlannerProvider'

const MAX_TASK_CAP = 10
const DAY_START_HOURS = [0, 1, 2, 3, 4, 5, 6]
const RULE_STEP = 1024

type Editing = { id: string | null; rule: Omit<Rule, 'order'> } | null

const hourName = (h: number) => (h === 0 ? 'Midnight' : `${h} AM`)

/** Route /rules: the if-then plans (spec #10) plus the plan settings (caps, day start). */
export function RulesPage() {
  const planner = usePlanner()
  const { docs, status } = usePlannerState()
  const rules = useMemo(() => planner.rules(), [planner, docs])
  const settings = useMemo(() => planner.settings(), [planner, docs])
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Doc<Rule> | null>(null)

  // The starter rules are created the first time this page opens (once per account).
  useEffect(() => {
    if (status === 'ready') void planner.seedRules()
  }, [planner, status])

  const toggle = (doc: Doc<Rule>) => void planner.saveRule(doc.id, { ...doc.data, active: !doc.data.active })

  /** Move a rule one place up or down: a new order between its new neighbours (one write). */
  const move = (index: number, dir: -1 | 1) => {
    const doc = rules[index]
    const target = index + dir
    if (!doc || target < 0 || target >= rules.length) return
    const near = rules[target].data.order
    const far = rules[target + dir]?.data.order
    const order = far === undefined ? near + dir * RULE_STEP : (near + far) / 2
    void planner.saveRule(doc.id, { ...doc.data, order })
  }

  const remove = (doc: Doc<Rule>) => {
    void planner.removeRule(doc.id).then(
      (ok) =>
        ok &&
        toast('Rule deleted', {
          action: { label: 'Undo', onClick: () => void planner.saveRule(doc.id, doc.data) },
        }),
    )
  }

  const save = (id: string | null, rule: Omit<Rule, 'order'>) => {
    void planner.saveRule(id, rule).then((ok) => ok && !id && toast.success('Rule added'))
  }

  const loading = status === 'idle' || status === 'loading'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-8">
      <div className="flex items-start gap-3">
        <Link to="/today" className={buttonClass('ghost', 'icon', '-ml-2 shrink-0')} aria-label="Back to Today">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-xl font-semibold tracking-tight">Rules</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Decide calmly now, so the moment you slip already has an answer.</p>
        </div>
        {status === 'ready' && (
          <Button size="sm" className="mt-1" onClick={() => setEditing({ id: null, rule: { ifText: '', thenText: '', reason: null, active: true } })}>
            <Plus aria-hidden />
            <span className="max-sm:sr-only">Add rule</span>
          </Button>
        )}
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading rules">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-card" />
            ))}
          </div>
        ) : status === 'setup' ? (
          <EmptyState
            icon={<Waypoints />}
            title="Planner not set up yet"
            description="The database is missing the planner table. Run supabase/migrations/20261018000000_planner.sql in the Supabase SQL Editor, then reload."
          />
        ) : status === 'error' ? (
          <EmptyState
            icon={<RefreshCw />}
            title="Couldn't load your rules"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Waypoints />}
            title="No rules yet"
            description="Write one if-then plan for the moment you usually slip."
            action={<Button onClick={() => setEditing({ id: null, rule: { ifText: '', thenText: '', reason: null, active: true } })}>Add rule</Button>}
          />
        ) : (
          <ul className="space-y-2.5">
            {rules.map((doc, index) => (
              <RuleCard
                key={doc.id}
                doc={doc}
                first={index === 0}
                last={index === rules.length - 1}
                onToggle={() => toggle(doc)}
                onEdit={() => setEditing({ id: doc.id, rule: { ifText: doc.data.ifText, thenText: doc.data.thenText, reason: doc.data.reason, active: doc.data.active } })}
                onDelete={() => setDeleting(doc)}
                onMove={(dir) => move(index, dir)}
              />
            ))}
          </ul>
        )}
      </div>

      {status === 'ready' && (
        <div className="mt-10 space-y-4">
          <SettingsCard
            blockCap={settings.blockCap}
            taskCap={settings.taskCap}
            dayStartHour={settings.dayStartHour}
            onChange={(patch) => void planner.updateSettings(patch)}
          />
          <HowItWorks />
        </div>
      )}

      <RuleDialog editing={editing} onClose={() => setEditing(null)} onSave={save} />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this rule?"
        description={deleting ? <>“IF {deleting.data.ifText}” will be removed. You can undo right after.</> : null}
        confirmLabel="Delete"
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </main>
  )
}

// ---- rule card ------------------------------------------------------------------

function RuleCard({
  doc,
  first,
  last,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  doc: Doc<Rule>
  first: boolean
  last: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const { ifText, thenText, reason, active } = doc.data
  return (
    <li className={cn('animate-fade-up rounded-2xl border border-line bg-card p-4 shadow-xs transition-opacity', !active && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5 text-[15px] leading-snug break-words">
          <p className="text-ink">
            <span className="mr-1.5 text-xs font-semibold tracking-wide text-accent">IF</span>
            {ifText}
          </p>
          <p className="text-ink-muted">
            <span className="mr-1.5 text-xs font-semibold tracking-wide text-accent">THEN</span>
            {thenText}
          </p>
        </div>
        <Switch checked={active} onChange={onToggle} label={`Rule active: IF ${ifText}`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {reason ? (
          <span className="mr-auto inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-medium text-accent">
            Skip: {SKIP_REASON_LABEL[reason]}
          </span>
        ) : (
          <span className="mr-auto" />
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={first} aria-label="Move rule up">
          <ArrowUp aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => onMove(1)} disabled={last} aria-label="Move rule down">
          <ArrowDown aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit rule">
          <Pencil aria-hidden />
        </Button>
        <Button variant="danger-ghost" size="icon-sm" onClick={onDelete} aria-label="Delete rule">
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  )
}

/** 24px tall to look right; on touch screens an invisible ::before widens the hit area to 40×56px. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors motion-reduce:transition-none',
        'pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:rounded-full',
        focusRing,
        checked ? 'border-transparent bg-accent-solid' : 'border-line-strong bg-sunken',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  )
}

// ---- add / edit dialog -------------------------------------------------------------

const fieldClass =
  'block w-full resize-y rounded-xl border border-line bg-card px-3.5 py-2.5 text-base leading-relaxed text-ink placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-[15px]'

function RuleDialog({
  editing,
  onClose,
  onSave,
}: {
  editing: Editing
  onClose: () => void
  onSave: (id: string | null, rule: Omit<Rule, 'order'>) => void
}) {
  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={editing?.id ? 'Edit rule' : 'Add rule'}
      description="When this happens, do that. Keep the THEN small and physical."
    >
      {/* Keyed so each open starts from the rule being edited. */}
      {editing && <RuleForm key={editing.id ?? 'new'} editing={editing} onClose={onClose} onSave={onSave} />}
    </Modal>
  )
}

function RuleForm({ editing, onClose, onSave }: { editing: NonNullable<Editing>; onClose: () => void; onSave: Parameters<typeof RuleDialog>[0]['onSave'] }) {
  const [ifText, setIfText] = useState(editing.rule.ifText)
  const [thenText, setThenText] = useState(editing.rule.thenText)
  const [reason, setReason] = useState<SkipReason | null>(editing.rule.reason)
  const id = useId()
  const valid = ifText.trim() !== '' && thenText.trim() !== ''

  const submit = () => {
    if (!valid) return
    onSave(editing.id, { ...editing.rule, ifText: ifText.trim(), thenText: thenText.trim(), reason })
    onClose()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor={`${id}-if`} className="mb-1.5 block text-sm font-medium text-ink">
          IF
        </label>
        <textarea
          id={`${id}-if`}
          value={ifText}
          onChange={(e) => setIfText(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="I wake at 4 and reach for the phone"
          autoFocus={!editing.id}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-then`} className="mb-1.5 block text-sm font-medium text-ink">
          THEN
        </label>
        <textarea
          id={`${id}-then`}
          value={thenText}
          onChange={(e) => setThenText(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Go to the desk and say “Book open. One heading.”"
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor={`${id}-reason`} className="mb-1.5 block text-sm font-medium text-ink">
          Show when skipping because…
        </label>
        <select
          id={`${id}-reason`}
          value={reason ?? ''}
          onChange={(e) => setReason(e.target.value ? (e.target.value as SkipReason) : null)}
          aria-describedby={`${id}-reason-hint`}
          className={cn(fieldClass, 'h-11 resize-none py-0')}
        >
          <option value="">No skip reason</option>
          {SKIP_REASONS.map((r) => (
            <option key={r} value={r}>
              {SKIP_REASON_LABEL[r]}
            </option>
          ))}
        </select>
        <p id={`${id}-reason-hint`} className="mt-1.5 text-xs text-ink-subtle">
          The Skip sheet shows this rule when you pick that reason.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid}>
          {editing.id ? 'Save' : 'Add rule'}
        </Button>
      </div>
    </form>
  )
}

// ---- settings ----------------------------------------------------------------------

function SettingsCard({
  blockCap,
  taskCap,
  dayStartHour,
  onChange,
}: {
  blockCap: number
  taskCap: number
  dayStartHour: number
  onChange: (patch: { blockCap?: number; taskCap?: number; dayStartHour?: number }) => void
}) {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-line bg-card p-4 shadow-xs sm:p-5">
      <h2 id={`${id}-h`} className="text-base font-semibold tracking-tight">
        Plan settings
      </h2>
      <div className="mt-4 divide-y divide-line">
        <SettingRow
          label="Block cap"
          hint="Deep blocks a day. Start at 2. Add one only after a week with the Floor on 5 of 7 days."
        >
          <Stepper label="Block cap" value={blockCap} min={1} max={MAX_BLOCK_CAP} onChange={(v) => onChange({ blockCap: v })} />
        </SettingRow>
        <SettingRow label="Task cap" hint="Small tasks a day. Fewer is lighter.">
          <Stepper label="Task cap" value={taskCap} min={1} max={MAX_TASK_CAP} onChange={(v) => onChange({ taskCap: v })} />
        </SettingRow>
        <SettingRow label="Day starts at" hint="Late nights count toward the previous day." htmlFor={`${id}-start`}>
          <select
            id={`${id}-start`}
            value={dayStartHour}
            onChange={(e) => onChange({ dayStartHour: Number(e.target.value) })}
            className="h-10 rounded-xl border border-line bg-card px-3 text-base text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 sm:text-sm"
          >
            {DAY_START_HOURS.map((h) => (
              <option key={h} value={h}>
                {hourName(h)}
              </option>
            ))}
          </select>
        </SettingRow>
      </div>
    </section>
  )
}

function SettingRow({ label, hint, htmlFor, children }: { label: string; hint: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium text-ink">{label}</p>
        )}
        <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 items-center rounded-xl border border-line bg-sunken p-0.5">
      <Button variant="ghost" size="icon-sm" onClick={() => set(value - 1)} disabled={value <= min} aria-label={`Fewer (${label})`}>
        <Minus aria-hidden />
      </Button>
      <output aria-live="polite" className="w-8 text-center text-sm font-semibold tabular-nums text-ink">
        {value}
      </output>
      <Button variant="ghost" size="icon-sm" onClick={() => set(value + 1)} disabled={value >= max} aria-label={`More (${label})`}>
        <Plus aria-hidden />
      </Button>
    </div>
  )
}

// ---- explainer ---------------------------------------------------------------------

const HOW_IT_WORKS: Array<[string, string]> = [
  ['Shutdown before screens', '10 minutes to close the day and set tomorrow’s first action. Leisure comes after.'],
  ['Block 1 before phone', 'Paper, pen, timer. No phone or laptop until its minimum is done.'],
  ['Start, Shrink, Say', 'Start for 2 minutes. Still no? Shrink it. Still no? Skip it with a reason.'],
  ['Floor = Block 1 + Shutdown', 'Hit that and the day counts as a win.'],
  ['Never miss twice', 'One zero day is data. The next day’s Floor is not optional.'],
]

function HowItWorks() {
  const id = useId()
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-line bg-sunken p-4 sm:p-5">
      <h2 id={`${id}-h`} className="text-base font-semibold tracking-tight">
        How the day works
      </h2>
      <ul className="mt-3 space-y-2.5">
        {HOW_IT_WORKS.map(([title, body]) => (
          <li key={title} className="flex gap-2.5 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="min-w-0">
              <span className="font-medium text-ink">{title}.</span> <span className="text-ink-muted">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
