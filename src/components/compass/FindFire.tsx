import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Flame, Plus, X } from 'lucide-react'
import { SegmentButton, Segmented } from '@/components/DayPicker'
import { celebrate } from '@/components/celebrate'
import { Button, focusRing, TextField } from '@/components/ui'
import { FIRE_MINUTES, MAX_ANSWER, MAX_CANDIDATES, MAX_FIRE_TEXT, SCORE_DIMS, type Candidate, type Compass, type Verdict } from '@/domain/plan'
import { cn } from '@/lib/cn'
import {
  answeredCount,
  candidateScore,
  COMPASS_PROMPTS,
  duelPairs,
  fireScore,
  isScored,
  MIN_ANSWERS,
  rankCandidates,
  recordDuel,
  SCORE_LABEL,
  suggestCandidates,
} from '@/lib/compass'
import { newId } from '@/lib/id'
import { usePlanner } from '@/state/PlannerProvider'

/**
 * The wizard, one screen at a time:
 * intro → 8 prompts → name candidates → score each → duel (forced choices) → ranking →
 * coin test → commit to a 14-day Spark experiment.
 * Answers and candidates are saved as you go, so it can be left and resumed.
 */
type Step =
  | { name: 'intro' }
  | { name: 'prompt'; index: number }
  | { name: 'candidates' }
  | { name: 'score'; index: number }
  | { name: 'duel'; index: number }
  | { name: 'ranking' }
  | { name: 'coin' }
  | { name: 'commit'; title: string; runnerUp: string | null }

const textareaClass =
  'w-full rounded-xl border border-line bg-card px-3.5 py-3 text-base text-ink shadow-xs transition placeholder:text-ink-subtle hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-[15px]'

export function FindFire({
  compass,
  onExit,
  start,
}: {
  compass: Compass
  onExit: () => void
  /** Open straight on the commit form (from a verdict: reshape, or test the runner-up). */
  start?: { title: string; runnerUp: string | null; previous: Verdict }
}) {
  const [step, setStep] = useState<Step>(() =>
    start ? { name: 'commit', title: start.title, runnerUp: start.runnerUp } : compass.candidates.length ? { name: 'candidates' } : { name: 'intro' },
  )
  const [answers, setAnswers] = useState(compass.answers)
  const [candidates, setCandidates] = useState<Candidate[]>(compass.candidates)
  const planner = usePlanner()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [step])

  const saveCandidates = (next: Candidate[]) => {
    setCandidates(next)
    void planner.saveCandidates(next)
  }

  const content = (() => {
    switch (step.name) {
      case 'intro':
        return <Intro answered={answeredCount(answers)} onStart={() => setStep({ name: 'prompt', index: 0 })} onExit={onExit} />
      case 'prompt':
        return (
          <PromptStep
            index={step.index}
            value={answers[COMPASS_PROMPTS[step.index].id] ?? ''}
            onChange={(v) => setAnswers({ ...answers, [COMPASS_PROMPTS[step.index].id]: v })}
            onBack={() => setStep(step.index ? { name: 'prompt', index: step.index - 1 } : { name: 'intro' })}
            onNext={() => {
              void planner.saveAnswers(answers)
              setStep(step.index < COMPASS_PROMPTS.length - 1 ? { name: 'prompt', index: step.index + 1 } : { name: 'candidates' })
            }}
            canFinish={answeredCount(answers) >= MIN_ANSWERS}
          />
        )
      case 'candidates':
        return (
          <CandidatesStep
            answers={answers}
            candidates={candidates}
            onChange={saveCandidates}
            onBack={() => setStep({ name: 'prompt', index: COMPASS_PROMPTS.length - 1 })}
            onNext={() => setStep({ name: 'score', index: 0 })}
          />
        )
      case 'score': {
        const c = candidates[step.index]
        if (!c) return null
        return (
          <ScoreStep
            key={c.id}
            candidate={c}
            position={`${step.index + 1} of ${candidates.length}`}
            onBack={() => setStep(step.index ? { name: 'score', index: step.index - 1 } : { name: 'candidates' })}
            onSave={(scores) => {
              const next = candidates.map((x) => (x.id === c.id ? { ...x, scores, wins: 0, duels: 0 } : { ...x, wins: 0, duels: 0 }))
              saveCandidates(next)
              setStep(step.index < candidates.length - 1 ? { name: 'score', index: step.index + 1 } : { name: 'duel', index: 0 })
            }}
          />
        )
      }
      case 'duel':
        return (
          <DuelStep
            candidates={candidates}
            index={step.index}
            onPick={(winner, loser) => {
              const next = recordDuel(candidates, winner, loser)
              saveCandidates(next)
              const total = duelPairs(candidates).length
              setStep(step.index + 1 < total ? { name: 'duel', index: step.index + 1 } : { name: 'ranking' })
            }}
            onBack={() => setStep({ name: 'score', index: candidates.length - 1 })}
          />
        )
      case 'ranking':
        return (
          <RankingStep
            candidates={candidates}
            onCoin={() => setStep({ name: 'coin' })}
            onPick={(title, runnerUp) => setStep({ name: 'commit', title, runnerUp })}
            onRedo={() => {
              saveCandidates(candidates.map((c) => ({ ...c, wins: 0, duels: 0 })))
              setStep({ name: 'candidates' })
            }}
          />
        )
      case 'coin': {
        const [a, b] = rankCandidates(candidates)
        return (
          <CoinStep
            a={a.title}
            b={b?.title ?? null}
            onResult={(title, runnerUp) => setStep({ name: 'commit', title, runnerUp })}
            onBack={() => setStep({ name: 'ranking' })}
          />
        )
      }
      case 'commit':
        return (
          <CommitStep
            initialTitle={step.title}
            runnerUp={step.runnerUp}
            answers={answers}
            previous={start?.previous}
            onBack={start ? onExit : () => setStep({ name: 'ranking' })}
            onDone={onExit}
          />
        )
    }
  })()

  return <div className="animate-fade-up">{content}</div>
}

// ---- Screens ---------------------------------------------------------------------------

function Shell({ eyebrow, title, children, progress }: { eyebrow: string; title: string; children: ReactNode; progress?: number }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5 shadow-xs sm:p-7">
      {progress !== undefined && (
        <div className="mb-5 h-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Progress" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent-solid transition-[width] duration-300" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}
      <p className="text-xs font-semibold tracking-wide text-accent uppercase">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h2>
      {children}
    </section>
  )
}

function Nav({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-2">
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Back
        </Button>
      )}
      <div className="ml-auto flex gap-2">{next}</div>
    </div>
  )
}

function Intro({ answered, onStart, onExit }: { answered: number; onStart: () => void; onExit: () => void }) {
  return (
    <Shell eyebrow="Find your fire · about 20 minutes" title="Fire isn’t found by thinking. It’s lit by doing.">
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-muted">
        <p>
          Most people wait to feel passion before they start. It works the other way round: interest grows into passion once you
          invest in something and start getting better at it. So this has two halves.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <span className="text-ink">Find the direction.</span> Eight honest questions, then you name, score and pit your options
            against each other until one is left.
          </li>
          <li>
            <span className="text-ink">Test it for 14 days.</span> A short daily block, and one check-in after each: how alive you
            felt. The numbers tell you whether it’s real.
          </li>
        </ol>
        <p>Write fast and don’t polish. Nobody sees this but you.</p>
      </div>
      <Nav
        onBack={onExit}
        next={
          <Button size="lg" onClick={onStart}>
            {answered ? 'Continue' : 'Begin'}
            <ArrowRight aria-hidden />
          </Button>
        }
      />
    </Shell>
  )
}

function PromptStep({
  index,
  value,
  onChange,
  onBack,
  onNext,
  canFinish,
}: {
  index: number
  value: string
  onChange: (v: string) => void
  onBack: () => void
  onNext: () => void
  canFinish: boolean
}) {
  const prompt = COMPASS_PROMPTS[index]
  const id = useId()
  const last = index === COMPASS_PROMPTS.length - 1
  return (
    <Shell eyebrow={`Clue ${index + 1} of ${COMPASS_PROMPTS.length} · ${prompt.title}`} title={prompt.question} progress={(index + 1) / (COMPASS_PROMPTS.length + 4)}>
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <textarea
        id={id}
        key={prompt.id}
        autoFocus
        rows={5}
        maxLength={MAX_ANSWER}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={prompt.hint}
        className={cn(textareaClass, 'mt-4 resize-y')}
      />
      <p className="mt-2 text-xs text-ink-subtle">Why this works: {prompt.why}</p>
      <Nav
        onBack={onBack}
        next={
          <>
            {!value.trim() && (
              <Button variant="ghost" onClick={onNext} disabled={last && !canFinish}>
                Skip
              </Button>
            )}
            <Button onClick={onNext} disabled={(!value.trim() && !last) || (last && !canFinish)}>
              Next
              <ArrowRight aria-hidden />
            </Button>
          </>
        }
      />
      {last && !canFinish && <p className="mt-2 text-right text-xs text-ink-subtle">Answer at least {MIN_ANSWERS} questions to go on.</p>}
    </Shell>
  )
}

function CandidatesStep({
  answers,
  candidates,
  onChange,
  onBack,
  onNext,
}: {
  answers: Record<string, string>
  candidates: Candidate[]
  onChange: (c: Candidate[]) => void
  onBack: () => void
  onNext: () => void
}) {
  const [text, setText] = useState('')
  const suggestions = useMemo(() => suggestCandidates(answers, candidates.map((c) => c.title)), [answers, candidates])
  const full = candidates.length >= MAX_CANDIDATES
  const add = (title: string) => {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, MAX_FIRE_TEXT)
    if (!clean || full) return
    onChange([...candidates, { id: newId(), title: clean, scores: {}, wins: 0, duels: 0 }])
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add(text)
    setText('')
  }
  return (
    <Shell eyebrow="Your options" title="Name 2–6 things you could pursue." progress={(COMPASS_PROMPTS.length + 1) / (COMPASS_PROMPTS.length + 4)}>
      <p className="mt-2 text-sm text-ink-muted">
        Read your answers and look for what repeats. Make each one something you could <em>do</em>: “make short history videos”, not
        “history”. Try three kinds: the path you’re on, the one you’d take if that vanished, and the wild card.
      </p>
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <input
          aria-label="New option"
          value={text}
          maxLength={MAX_FIRE_TEXT}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Teach UPSC polity on YouTube"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent focus:ring-4 focus:ring-accent/15 focus:outline-none sm:text-sm"
        />
        <Button type="submit" size="lg" disabled={!text.trim() || full}>
          <Plus aria-hidden />
          Add
        </Button>
      </form>
      {suggestions.length > 0 && !full && (
        <div className="mt-3">
          <p className="text-xs text-ink-subtle">From your answers (tap to add):</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className={cn('min-h-8 rounded-full border border-dashed border-line-strong px-3 text-xs text-ink-muted hover:border-accent hover:text-accent', focusRing)}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {candidates.length > 0 && (
        <ul className="mt-5 flex flex-col gap-2" aria-label="Your options">
          {candidates.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
              <span className="min-w-0 flex-1 text-sm break-words text-ink">{c.title}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.title}`} onClick={() => onChange(candidates.filter((x) => x.id !== c.id))}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Nav
        onBack={onBack}
        next={
          <Button onClick={onNext} disabled={candidates.length < 2}>
            Score them
            <ArrowRight aria-hidden />
          </Button>
        }
      />
    </Shell>
  )
}

function ScoreStep({
  candidate,
  position,
  onBack,
  onSave,
}: {
  candidate: Candidate
  position: string
  onBack: () => void
  onSave: (scores: Candidate['scores']) => void
}) {
  const [scores, setScores] = useState(candidate.scores)
  const done = SCORE_DIMS.every((d) => typeof scores[d] === 'number')
  return (
    <Shell eyebrow={`Score · ${position} · go with your gut`} title={candidate.title}>
      <div className="mt-4 flex flex-col gap-4">
        {SCORE_DIMS.map((dim) => (
          <div key={dim}>
            <p className="text-sm text-ink">
              <span className="font-semibold">{SCORE_LABEL[dim].name}.</span> <span className="text-ink-muted">{SCORE_LABEL[dim].question}</span>
            </p>
            <div className="mt-1.5">
              <Segmented label={SCORE_LABEL[dim].name}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SegmentButton key={n} pressed={scores[dim] === n} onClick={() => setScores({ ...scores, [dim]: n })}>
                    <span className="px-1 tabular-nums">{n}</span>
                  </SegmentButton>
                ))}
              </Segmented>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-subtle">1 = not at all, 5 = very. Pull, curiosity and regret count double: they’re what fire is made of.</p>
      <Nav
        onBack={onBack}
        next={
          <Button onClick={() => onSave(scores)} disabled={!done}>
            Next
            <ArrowRight aria-hidden />
          </Button>
        }
      />
    </Shell>
  )
}

function DuelStep({
  candidates,
  index,
  onPick,
  onBack,
}: {
  candidates: Candidate[]
  index: number
  onPick: (winnerId: string, loserId: string) => void
  onBack: () => void
}) {
  // Pairs come from the scores, which don't change during the duel.
  const pairs = useMemo(() => duelPairs(candidates), [candidates.map((c) => `${c.id}:${candidateScore(c)}`).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const pair = pairs[index]
  if (!pair) return null
  const [a, b] = pair
  return (
    <Shell eyebrow={`Only one · ${index + 1} of ${pairs.length}`} title="You can only do one of these for the next two weeks. Which?">
      <p className="mt-2 text-sm text-ink-muted">Decide in 5 seconds. Your first reaction is the information.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[a, b].map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id, (i ? a : b).id)}
            className={cn(
              'min-h-28 rounded-2xl border-2 border-line bg-card p-4 text-left text-base font-semibold break-words text-ink transition hover:border-accent hover:bg-accent-soft/40 active:scale-[0.98] motion-reduce:active:scale-100',
              focusRing,
            )}
          >
            {c.title}
          </button>
        ))}
      </div>
      <Nav onBack={index === 0 ? onBack : undefined} next={null} />
    </Shell>
  )
}

function RankingStep({
  candidates,
  onCoin,
  onPick,
  onRedo,
}: {
  candidates: Candidate[]
  onCoin: () => void
  onPick: (title: string, runnerUp: string | null) => void
  onRedo: () => void
}) {
  const ranked = rankCandidates(candidates.filter(isScored))
  const [top, second] = ranked
  if (!top) return null
  const close = second && fireScore(top) - fireScore(second) <= 10
  return (
    <Shell eyebrow="Your ranking" title={close ? 'Two are neck and neck.' : `“${top.title}” comes out on top.`}>
      <ol className="mt-4 flex flex-col gap-2">
        {ranked.map((c, i) => {
          const s = fireScore(c)
          return (
            <li key={c.id} className={cn('rounded-xl px-3 py-2.5', i === 0 ? 'bg-accent-soft' : 'bg-sunken')}>
              <div className="flex items-baseline gap-2">
                <span className="w-5 text-sm font-semibold text-ink-subtle tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-medium break-words text-ink">{c.title}</span>
                <span className="text-sm font-semibold text-ink tabular-nums">{s}</span>
              </div>
              <div className="mt-1.5 ml-7 h-1.5 overflow-hidden rounded-full bg-card" aria-hidden>
                <div className={cn('h-full rounded-full', i === 0 ? 'bg-accent-solid' : 'bg-line-strong')} style={{ width: `${Math.max(3, s)}%` }} />
              </div>
              {c.duels > 0 && (
                <p className="mt-1 ml-7 text-[11px] text-ink-subtle">
                  Won {c.wins} of {c.duels} head-to-heads
                </p>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-4 text-sm text-ink-muted">
        {close
          ? 'The numbers can’t split them, but your gut can. The coin test shows what you actually want.'
          : 'Before you commit, check it against your gut with the coin test. It takes 10 seconds.'}
      </p>
      <Nav
        onBack={onRedo}
        next={
          <>
            {!close && (
              <Button variant="ghost" onClick={() => onPick(top.title, second?.title ?? null)}>
                Skip the coin
              </Button>
            )}
            <Button onClick={onCoin} disabled={!second}>
              Coin test
              <ArrowRight aria-hidden />
            </Button>
          </>
        }
      />
    </Shell>
  )
}

/**
 * The coin test: the coin "decides" between the top two. The moment it lands you feel relief or
 * disappointment, and that feeling is the real answer, not the coin.
 */
function CoinStep({ a, b, onResult, onBack }: { a: string; b: string | null; onResult: (title: string, runnerUp: string | null) => void; onBack: () => void }) {
  const [landed, setLanded] = useState<string | null>(null)
  const [flipping, setFlipping] = useState(false)
  const other = landed === a ? b : a
  const flip = () => {
    setFlipping(true)
    const side = Math.random() < 0.5 ? a : (b ?? a)
    window.setTimeout(
      () => {
        setFlipping(false)
        setLanded(side)
      },
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 50 : 1400,
    )
  }
  return (
    <Shell eyebrow="The coin test" title={landed ? `The coin says: ${landed}` : 'Let a coin decide between your top two.'}>
      {!landed ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Heads: <span className="text-ink">{a}</span>. Tails: <span className="text-ink">{b}</span>. Commit to doing whatever it says.
            Then notice your very first feeling when it lands.
          </p>
          <div className="mt-6 grid place-items-center" style={{ perspective: '600px' }}>
            <div
              aria-hidden
              className={cn(
                'grid size-24 place-items-center rounded-full bg-linear-to-br from-amber-300 to-amber-500 text-3xl font-bold text-amber-900 shadow-lg ring-4 ring-amber-200 dark:ring-amber-700',
                flipping && 'animate-coin motion-reduce:animate-none',
              )}
            >
              ₹
            </div>
          </div>
          <Nav
            onBack={onBack}
            next={
              <Button size="lg" onClick={flip} loading={flipping}>
                Flip the coin
              </Button>
            }
          />
        </>
      ) : (
        <>
          <p className="mt-3 text-[15px] text-ink-muted">Right now, in your chest: what did you feel when you saw it?</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onResult(landed, other)}
              className={cn('rounded-2xl border-2 border-line p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-500/5', focusRing)}
            >
              <span className="block font-semibold text-ink">Relief. “Yes, that one.”</span>
              <span className="mt-1 block text-sm text-ink-muted">Go with {landed}.</span>
            </button>
            {other && (
              <button
                type="button"
                onClick={() => onResult(other, landed)}
                className={cn('rounded-2xl border-2 border-line p-4 text-left transition hover:border-accent hover:bg-accent-soft/40', focusRing)}
              >
                <span className="block font-semibold text-ink">A small “oh no”.</span>
                <span className="mt-1 block text-sm text-ink-muted">You wanted {other}. Go with that.</span>
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-ink-subtle">The coin doesn’t decide. It makes you find out what you were hoping for.</p>
        </>
      )}
    </Shell>
  )
}

function CommitStep({
  initialTitle,
  runnerUp,
  answers,
  previous,
  onBack,
  onDone,
}: {
  initialTitle: string
  runnerUp: string | null
  answers: Record<string, string>
  previous?: Verdict
  onBack: () => void
  onDone: () => void
}) {
  const planner = usePlanner()
  const [title, setTitle] = useState(initialTitle)
  const [why, setWhy] = useState('')
  const [output, setOutput] = useState('')
  const [minutes, setMinutes] = useState<number>(25)
  const [firstAction, setFirstAction] = useState('')
  const [cue, setCue] = useState('')
  const [saving, setSaving] = useState(false)
  const whyId = useId()
  const yourWords = ['regret', 'anger', 'envy'].map((k) => answers[k]?.trim()).filter(Boolean).slice(0, 2) as string[]

  const ready = title.trim() && why.trim() && output.trim() && firstAction.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setSaving(true)
    const ok = await planner.lightFire({ title, why, output, minutes, firstAction, cue, runnerUp }, previous)
    setSaving(false)
    if (!ok) return
    celebrate(null, 'big')
    onDone()
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <Shell eyebrow="Commit · the 14-day Spark" title="Light it.">
        <p className="mt-2 text-sm text-ink-muted">
          Vague plans don’t get done. Fill these in and it becomes a daily block in Today, with a check-in after each session.
        </p>
        <div className="mt-5 flex flex-col gap-4">
          <TextField label="What you’ll do" value={title} maxLength={MAX_FIRE_TEXT} onChange={(e) => setTitle(e.target.value)} />
          <div>
            <label htmlFor={whyId} className="mb-1.5 block text-sm font-medium text-ink">
              Why it matters to me (one sentence)
            </label>
            <textarea
              id={whyId}
              rows={2}
              maxLength={MAX_FIRE_TEXT}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Because…"
              className={textareaClass}
            />
            {yourWords.length > 0 && (
              <div className="mt-1.5 space-y-1 text-xs text-ink-subtle">
                <p>Your own words, earlier:</p>
                {yourWords.map((w) => (
                  <p key={w} className="line-clamp-2 italic">
                    “{w}”
                  </p>
                ))}
              </div>
            )}
          </div>
          <TextField
            label="In 14 days, this will exist (the output)"
            value={output}
            maxLength={MAX_FIRE_TEXT}
            onChange={(e) => setOutput(e.target.value)}
            placeholder="e.g. 3 published videos · a working prototype · 10 pages written"
            hint="Something you can show someone. Output, not effort."
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Every day, for</p>
            <Segmented label="Daily minutes">
              {FIRE_MINUTES.map((m) => (
                <SegmentButton key={m} pressed={minutes === m} onClick={() => setMinutes(m)}>
                  {m} min
                </SegmentButton>
              ))}
            </Segmented>
            <p className="mt-1.5 text-xs text-ink-subtle">Smaller than you think. Showing up daily beats long sessions you skip.</p>
          </div>
          <TextField
            label="First physical action"
            value={firstAction}
            maxLength={MAX_FIRE_TEXT}
            onChange={(e) => setFirstAction(e.target.value)}
            placeholder="e.g. Open a doc titled “Video 1 script” and write the hook"
            hint="Something your hands do in the first 2 minutes."
          />
          <TextField
            label="When: after I…"
            value={cue}
            maxLength={MAX_FIRE_TEXT}
            onChange={(e) => setCue(e.target.value)}
            placeholder="e.g. finish breakfast, at my desk"
            hint="Tying it to something you already do roughly doubles the odds you do it (implementation intentions)."
          />
        </div>
        <Nav
          onBack={onBack}
          next={
            <Button type="submit" size="lg" loading={saving} disabled={!ready}>
              <Flame aria-hidden />
              Start the 14 days
            </Button>
          }
        />
      </Shell>
    </form>
  )
}
