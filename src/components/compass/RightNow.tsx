import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight, Check, Navigation, RotateCcw, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { SegmentButton, Segmented } from '@/components/DayPicker'
import { Button, focusRing } from '@/components/ui'
import { cn } from '@/lib/cn'
import { BLOCKER_LABEL, BLOCKERS, pickNow, type Blocker, type Energy, type NowPick } from '@/lib/compass'
import { titleFromDump } from '@/lib/plan'
import { useDumpsState } from '@/state/DumpsProvider'
import { usePlanner, useToday } from '@/state/PlannerProvider'
import type { Compass } from '@/domain/plan'

const TIMES = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2+ hours' },
] as const

const ENERGIES: Array<{ value: Energy; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Okay' },
  { value: 'high', label: 'High' },
]

const KIND_LABEL: Record<NowPick['kind'], string> = {
  reset: 'First, a reset',
  fire: 'Your fire',
  item: 'From Today',
  tile: 'From your board',
  discover: 'The bigger question',
}

/**
 * "What should I do right now?": three quick questions (anything in the way, energy, time), then
 * one answer with its first two minutes, a reason, and a 5-second countdown that starts it.
 */
export function RightNow({ compass, onDiscover, loggedToday }: { compass: Compass; onDiscover: () => void; loggedToday: boolean }) {
  const planner = usePlanner()
  const view = useToday()
  const { active } = useDumpsState()
  const navigate = useNavigate()
  const [stage, setStage] = useState<'closed' | 'ask' | 'answer'>('closed')
  const [blockers, setBlockers] = useState<Blocker[]>([])
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [time, setTime] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [resetDone, setResetDone] = useState(false)
  const [counting, setCounting] = useState<NowPick | null>(null)

  const result = useMemo(() => {
    if (!energy || !time) return null
    const openItems = view.items
      .filter((i) => i.data.status === 'open' && !i.data.habit)
      .map((i) => ({ id: i.id, title: i.data.title, type: i.data.type, minutes: i.data.minutes, firstAction: i.data.firstAction, dumpId: i.data.dumpId }))
    const tiles = active
      .filter((d) => view.metas.get(d.id)?.priority === 'high' && !view.inToday.has(d.id) && d.id !== compass.fire?.dumpId)
      .slice(0, 3)
      .map((d) => ({ id: d.id, title: titleFromDump(d.content) }))
    const fire = compass.fire
      ? { title: compass.fire.title, firstAction: compass.fire.firstAction, minutes: compass.fire.minutes, dumpId: compass.fire.dumpId, loggedToday }
      : null
    return pickNow({ blockers, energy, time, fire, openItems, tiles })
  }, [blockers, energy, time, view.items, view.metas, view.inToday, active, compass.fire, loggedToday])

  const reset = result?.reset && !resetDone ? result.reset : null
  const picks = result?.picks ?? []
  const pick = reset ?? picks[index % Math.max(1, picks.length)] ?? null

  const restart = () => {
    setStage('ask')
    setBlockers([])
    setEnergy(null)
    setTime(null)
    setIndex(0)
    setResetDone(false)
  }

  const go = async (p: NowPick) => {
    if (p.kind === 'discover') return onDiscover()
    if (p.kind === 'reset') {
      if (p.title === 'Empty your head') return navigate('/')
      setResetDone(true)
      toast('Go. Come back when it’s done.', { description: 'Your next step is waiting here.' })
      return
    }
    let itemId = p.itemId
    let type = p.type ?? 'block'
    if (!itemId && p.dumpId) {
      const dump = active.find((d) => d.id === p.dumpId)
      const added = dump ? await planner.addFromDump(dump) : null
      if (added?.ok) {
        itemId = added.id
        type = planner.tileMeta(p.dumpId).defaultType
      }
    }
    if (itemId && type === 'block' && !view.focus) {
      const started = await planner.startFocus(itemId, p.minutes <= 10 ? 'shrink' : 'full')
      if (started) return navigate('/focus')
    }
    if (p.kind === 'fire') {
      toast('Go. Log the spark here when you’re done.')
      setStage('closed')
      return
    }
    navigate('/today')
  }

  if (counting) return <Countdown pick={counting} onDone={() => { const p = counting; setCounting(null); void go(p) }} onCancel={() => setCounting(null)} />

  if (stage === 'closed') {
    return (
      <button
        type="button"
        onClick={restart}
        className={cn(
          'group flex w-full items-center gap-3 rounded-3xl border border-line bg-card p-5 text-left shadow-xs transition hover:border-line-strong hover:bg-sunken/50',
          focusRing,
        )}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Navigation className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold tracking-tight text-ink">What should I do right now?</span>
          <span className="block text-sm text-ink-muted">Three taps. One answer.</span>
        </span>
        <ArrowRight className="size-5 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5" aria-hidden />
      </button>
    )
  }

  if (stage === 'ask') {
    return (
      <section aria-labelledby="now-title" className="animate-fade-up rounded-3xl border border-line bg-card p-5 shadow-xs sm:p-6">
        <h2 id="now-title" className="text-lg font-semibold tracking-tight">
          What should I do right now?
        </h2>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink">Anything in the way? (tap all that fit)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {BLOCKERS.map((b) => {
              const on = blockers.includes(b)
              return (
                <button
                  key={b}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setBlockers(on ? blockers.filter((x) => x !== b) : [...blockers, b])}
                  className={cn(
                    'min-h-9 rounded-full border px-3 text-sm transition',
                    on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
                    focusRing,
                  )}
                >
                  {BLOCKER_LABEL[b]}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Energy</p>
            <Segmented label="Energy">
              {ENERGIES.map((e) => (
                <SegmentButton key={e.value} pressed={energy === e.value} onClick={() => setEnergy(e.value)}>
                  {e.label}
                </SegmentButton>
              ))}
            </Segmented>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Time free</p>
            <Segmented label="Time free">
              {TIMES.map((t) => (
                <SegmentButton key={t.minutes} pressed={time === t.minutes} onClick={() => setTime(t.minutes)}>
                  {t.label}
                </SegmentButton>
              ))}
            </Segmented>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStage('closed')}>
            Cancel
          </Button>
          <Button disabled={!energy || !time} onClick={() => setStage('answer')}>
            Tell me
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="now-answer" className="animate-fade-up rounded-3xl border border-accent/30 bg-card p-5 shadow-sm sm:p-6">
      {pick ? (
        <>
          <p className="text-xs font-semibold tracking-wide text-accent uppercase">{KIND_LABEL[pick.kind]}</p>
          <h2 id="now-answer" className="mt-1 text-2xl font-semibold tracking-tight break-words text-ink">
            {pick.title}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {pick.minutes} min · {pick.why}
          </p>
          <div className="mt-4 rounded-2xl bg-sunken p-4">
            <p className="text-xs font-medium text-ink-subtle">The first 2 minutes</p>
            <p className="mt-1 text-[15px] text-ink">{pick.firstStep}</p>
          </div>
          {reset && picks[0] && <p className="mt-3 text-sm text-ink-muted">Then: {picks[0].title}.</p>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={() => (pick.kind === 'discover' ? onDiscover() : setCounting(pick))}>
              {pick.kind === 'discover' ? 'Start' : 'Start in 5'}
              <ArrowRight aria-hidden />
            </Button>
            {reset ? (
              <Button variant="ghost" onClick={() => setResetDone(true)}>
                <Check aria-hidden />
                Already fine, skip it
              </Button>
            ) : (
              picks.length > 1 && (
                <Button variant="ghost" onClick={() => setIndex((i) => i + 1)}>
                  <Shuffle aria-hidden />
                  Something else
                </Button>
              )
            )}
            <Button variant="ghost" className="ml-auto" onClick={restart}>
              <RotateCcw aria-hidden />
              Ask again
            </Button>
          </div>
          {!reset && picks.length > 1 && (
            <p className="mt-3 text-xs text-ink-subtle">
              Don’t shop around too long: the first answer is usually the right one. Deciding is the hard part; it’s done.
            </p>
          )}
        </>
      ) : (
        <>
          <h2 id="now-answer" className="text-xl font-semibold tracking-tight">
            Today’s work is done.
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Your queue is clear and today’s spark is logged. Rest without guilt, or pick something from your board.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/')}>
              Open the board
            </Button>
            <Button variant="ghost" onClick={() => setStage('closed')}>
              Close
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/** 5-4-3-2-1, then go (Mel Robbins’ 5-second rule: act before the brain talks you out of it). */
function Countdown({ pick, onDone, onCancel }: { pick: NowPick; onDone: () => void; onCancel: () => void }) {
  const [n, setN] = useState(5)
  useEffect(() => {
    if (n === 0) {
      onDone()
      return
    }
    const t = window.setTimeout(() => setN((x) => x - 1), 1000)
    return () => window.clearTimeout(t)
    // onDone changes identity every render; the count drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])
  return (
    <section aria-live="assertive" className="grid min-h-64 place-items-center rounded-3xl border border-accent/30 bg-card p-6 text-center shadow-sm">
      <div>
        <p className="text-sm text-ink-muted">{pick.title}</p>
        <p key={n} className="animate-count mt-2 text-7xl font-semibold text-accent tabular-nums motion-reduce:animate-none">
          {n > 0 ? n : 'Go'}
        </p>
        <p className="mt-3 text-sm text-ink-muted">{pick.firstStep}</p>
        <Button variant="ghost" className="mt-4" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
