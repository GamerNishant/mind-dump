import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Pause, Play, Plus, Square } from 'lucide-react'
import { toast } from 'sonner'
import { ChoiceChips } from '@/components/today/SkipSheet'
import { Button, LogoMark, Modal } from '@/components/ui'
import { STARTER_MINUTES, type FocusSession } from '@/domain/plan'
import { focusElapsedMs, focusRemainingMs, formatClock, type Doc } from '@/lib/plan'
import { useDumpsStore } from '@/state/DumpsProvider'
import { usePlanner, useToday } from '@/state/PlannerProvider'

const EXTEND_MINUTES = 10
const TIME_UP_TITLE = '⏰ Time — Mind Dump'

/** Wall clock that ticks every second (and catches up when the tab becomes visible again). */
function useSecondClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = window.setInterval(tick, 1000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return now
}

/** Two soft sine tones. Browsers may block audio without a prior gesture; that's fine. */
function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void ctx.resume().catch(() => {})
    const tone = (freq: number, start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + start
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.75)
    }
    tone(660, 0)
    tone(880, 0.35)
    window.setTimeout(() => void ctx.close().catch(() => {}), 1500)
  } catch {
    // No audio available: the title and the dialog still signal the end.
  }
}

export function FocusPage() {
  const view = useToday()
  const session = view.focus

  if (!session) {
    if (view.status === 'idle' || view.status === 'loading') {
      return (
        <main className="grid min-h-[60dvh] place-items-center px-4" role="status" aria-label="Loading">
          <LogoMark className="size-10 animate-pulse" />
        </main>
      )
    }
    return <Navigate to="/today" replace />
  }

  return <FocusView key={session.id} session={session} />
}

function FocusView({ session }: { session: Doc<FocusSession> }) {
  const planner = usePlanner()
  const dumps = useDumpsStore()
  const navigate = useNavigate()
  const now = useSecondClock()
  const s = session.data

  const elapsed = focusElapsedMs(s, now)
  const remaining = focusRemainingMs(s, now)
  const totalMs = s.plannedMin * 60_000
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, elapsed / totalMs)) : 1
  const paused = !!s.pausedAt
  const timeUp = remaining <= 0
  const clock = formatClock(remaining)
  const inStarter = s.starter && elapsed < STARTER_MINUTES * 60_000

  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // ---- document.title: remaining time while running, a flag when time is up -----------------
  const originalTitle = useRef(document.title)
  useEffect(() => {
    const original = originalTitle.current
    return () => {
      document.title = original
    }
  }, [])
  useEffect(() => {
    document.title = timeUp ? TIME_UP_TITLE : paused ? `Paused ${clock} · Focus` : `${clock} · Focus`
  }, [timeUp, paused, clock])

  // ---- time up: chime + open the End dialog once (again after an extension runs out) ---------
  const firedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!timeUp || paused) return
    const key = `${session.id}:${s.plannedMin}`
    if (firedFor.current === key) return
    firedFor.current = key
    playChime()
    setEndOpen(true)
  }, [timeUp, paused, session.id, s.plannedMin])

  // ---- controls ---------------------------------------------------------------------------------
  const togglePause = () => void (paused ? planner.resumeFocus(session.id) : planner.pauseFocus(session.id))
  const extend = () => {
    void planner.extendFocus(session.id, EXTEND_MINUTES).then((ok) => ok && toast(`+${EXTEND_MINUTES} min`))
  }

  // ---- park a thought -----------------------------------------------------------------------------
  const [thought, setThought] = useState('')
  const park = (e: FormEvent) => {
    e.preventDefault()
    const text = thought.trim()
    if (!text) return
    setThought('')
    void dumps.add([text]).then((ok) => {
      if (ok) toast('Parked in your dump', { description: text })
      else setThought((cur) => cur || text)
    })
  }

  // ---- ring geometry ------------------------------------------------------------------------------
  const R = 46
  const C = 2 * Math.PI * R

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] w-full max-w-xl flex-col px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">{paused ? 'Paused' : timeUp ? "Time's up" : 'Focus'}</p>
        <h1 className="mt-1 line-clamp-2 max-w-full text-base font-medium break-words text-ink-muted">{s.title}</h1>

        {s.firstAction.trim() ? (
          <p className="mt-4 max-w-full text-2xl leading-snug font-semibold tracking-tight break-words text-ink sm:text-3xl">{s.firstAction}</p>
        ) : (
          <p className="mt-4 text-2xl leading-snug font-semibold tracking-tight text-ink sm:text-3xl">Open it. Do the first line.</p>
        )}
        {s.minimum.trim() && (
          <p className="mt-2 max-w-full text-sm break-words text-ink-muted">
            Minimum: <span className="font-medium text-ink">{s.minimum}</span>
          </p>
        )}

        {/* Countdown ring */}
        <div className="relative mt-8 size-60 sm:size-72">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r={R} fill="none" strokeWidth="4" className="stroke-line" />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - progress)}
              className={timeUp ? 'stroke-accent' : paused ? 'stroke-ink-subtle' : 'stroke-accent transition-[stroke-dashoffset] duration-1000 ease-linear'}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              role="timer"
              aria-label={`${clock} remaining`}
              className={'text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl ' + (paused ? 'text-ink-subtle' : 'text-ink')}
            >
              {clock}
            </span>
            <span className="mt-1 text-xs text-ink-subtle">of {s.plannedMin} min</span>
          </div>
        </div>

        <p className="mt-5 min-h-5 text-sm text-ink-muted" aria-live="polite">
          {timeUp
            ? 'Time. Write where you stopped.'
            : s.starter
              ? inStarter
                ? 'Just 2 minutes. You can stop after.'
                : "You're in. Keep going."
              : ''}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {!timeUp && (
            <Button variant="secondary" size="lg" onClick={togglePause} aria-pressed={paused}>
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          <Button variant="secondary" size="lg" onClick={extend}>
            <Plus aria-hidden />
            {EXTEND_MINUTES} min
          </Button>
          <Button size="lg" onClick={() => setEndOpen(true)}>
            <Square aria-hidden />
            End
          </Button>
        </div>
      </div>

      <form onSubmit={park} className="mt-10 w-full">
        <label htmlFor="park-thought" className="mb-1.5 block text-xs font-medium text-ink-subtle">
          Park a thought
        </label>
        <input
          id="park-thought"
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          placeholder="Idea, worry, to-do… Enter to park it"
          enterKeyHint="done"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-line bg-card px-3.5 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
        />
      </form>

      <EndDialog
        open={endOpen}
        session={session}
        busy={busy}
        onClose={() => setEndOpen(false)}
        onSubmit={async (minMet, stoppedAt) => {
          setBusy(true)
          const ok = await planner.endFocus(session.id, { minMet, stoppedAt })
          setBusy(false)
          if (!ok) return
          setEndOpen(false)
          toast(stoppedAt.trim() ? 'Block logged. Bookmark saved.' : 'Block logged.')
          navigate('/today')
        }}
      />
    </main>
  )
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const

function EndDialog({
  open,
  session,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  session: Doc<FocusSession>
  busy: boolean
  onClose: () => void
  onSubmit: (minMet: boolean, stoppedAt: string) => void
}) {
  const planner = usePlanner()
  const [met, setMet] = useState<'yes' | 'no' | null>(null)
  const [stoppedAt, setStoppedAt] = useState('')

  // Prefill each time the dialog opens: the tile's Bookmark is the last note.
  useEffect(() => {
    if (!open) return
    setMet(null)
    const { dumpId } = session.data
    setStoppedAt(dumpId ? planner.tileMeta(dumpId).resumeNote : session.data.stoppedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = () => {
    if (!met || busy) return
    onSubmit(met === 'yes', stoppedAt)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="End the block"
      description={session.data.minimum.trim() ? <>Minimum: {session.data.minimum}</> : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not yet
          </Button>
          <Button onClick={submit} disabled={!met} loading={busy}>
            Log block
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-5"
      >
        <ChoiceChips label="Minimum met?" options={YES_NO} value={met} onChange={setMet} />
        <div>
          <label htmlFor="stopped-at" className="mb-1.5 block text-xs font-medium text-ink-muted">
            Where did you stop?
          </label>
          <input
            id="stopped-at"
            value={stoppedAt}
            onChange={(e) => setStoppedAt(e.target.value)}
            placeholder="e.g. PSIR p.22, heading 3"
            maxLength={200}
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-line bg-card px-3.5 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
          />
          <p className="mt-1.5 text-xs text-ink-subtle">Saved as the Bookmark: it becomes the next first action.</p>
        </div>
      </form>
    </Modal>
  )
}
