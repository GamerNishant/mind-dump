import {
  emptyCompass,
  FIRE_DAYS,
  KIND,
  MAX_ANSWER,
  MAX_CANDIDATES,
  SCORE_DIMS,
  type Candidate,
  type Compass,
  type Fire,
  type FocusSession,
  type ScoreDim,
  type Spark,
  type Verdict,
} from '@/domain/plan'
import { parseHour } from './hours'
import { addDays, daysFrom, docsOfKind, focusElapsedMs, hourLogOf, singleton, stableId, type Docs } from './plan'

/**
 * Compass rules (pure): the "Find your fire" prompts, how candidate directions are scored and
 * ranked, the 14-day Spark experiment's numbers and verdict, and the "What should I do right
 * now?" picker. Nothing here guesses what you want; it turns your own answers and check-ins into
 * one clear next step.
 */

export const compassId = (userId: string) => stableId(KIND.compass, userId)

// ---- Find your fire: the prompts ---------------------------------------------------

export interface CompassPrompt {
  id: string
  title: string
  question: string
  /** Examples that make it easier to start typing. */
  hint: string
  /** Why the question works, in one line. */
  why: string
}

export const COMPASS_PROMPTS: readonly CompassPrompt[] = [
  {
    id: 'flow',
    title: 'Lost time',
    question: 'When did you last lose track of time because you were into something? Any age, anything.',
    hint: 'Fixing a friend’s laptop at 2 AM, drawing maps as a kid, arguing about history, editing a video…',
    why: 'Flow, where hours vanish, is the most reliable sign that an activity fits you (Csikszentmihalyi).',
  },
  {
    id: 'envy',
    title: 'Envy',
    question: 'Whose life or work makes you a little jealous? What exactly about it?',
    hint: 'Not “they’re rich”: “they get to build things people use”, “they teach and people listen”.',
    why: 'Envy is a map of what you want but haven’t let yourself admit (Julia Cameron).',
  },
  {
    id: 'kid',
    title: 'Age 12',
    question: 'What did you do at 10–14 when nobody made you?',
    hint: 'Collected things, took apart toys, wrote stories, organised games, read under the blanket…',
    why: 'Before grades and money, interests were honest. They often still are.',
  },
  {
    id: 'rabbit',
    title: 'Rabbit holes',
    question: 'What do you read, watch or google about for free, when nobody is grading you?',
    hint: 'Check your YouTube history or saved posts. What keeps coming back?',
    why: 'Where your attention goes for free is where your curiosity lives.',
  },
  {
    id: 'anger',
    title: 'What makes you angry',
    question: 'What problem do you keep noticing that makes you think “someone should fix this”?',
    hint: 'Bad teaching, wasted talent in small towns, broken government forms, people being cheated…',
    why: 'A fire usually burns against something. Meaning comes from a problem you can’t ignore.',
  },
  {
    id: 'regret',
    title: 'At 80',
    question: 'You are 80, looking back. What would you regret never having seriously tried?',
    hint: 'Not “should have earned more”. What attempt would you be sad you never made?',
    why: 'Imagining the end strips away fear and status (Bezos’s regret-minimisation test).',
  },
  {
    id: 'free',
    title: 'No fear, no money worries',
    question: 'If money were sorted for a year and nobody would judge you, how would you spend that year?',
    hint: 'Be specific: what would a Tuesday look like?',
    why: 'Removing the two loudest blockers shows what is underneath them.',
  },
  {
    id: 'asked',
    title: 'What people ask you for',
    question: 'What do people ask you for help with, or praise you for, that feels easy to you?',
    hint: 'Explaining things, planning trips, fixing tech, calming people down, spotting patterns…',
    why: 'What feels easy to you and hard to others is a strength you don’t see.',
  },
]

/** At least this many answers before naming candidates. */
export const MIN_ANSWERS = 3

export const answeredCount = (answers: Record<string, string>) =>
  COMPASS_PROMPTS.filter((p) => (answers[p.id] ?? '').trim().length > 0).length

/**
 * Short phrases pulled from the answers, offered as one-tap candidates. Splits on lines,
 * commas, semicolons and full stops, keeps 3–48 character pieces, and drops duplicates.
 */
export function suggestCandidates(answers: Record<string, string>, taken: readonly string[] = []): string[] {
  const seen = new Set(taken.map((t) => t.trim().toLowerCase()))
  const out: string[] = []
  for (const p of COMPASS_PROMPTS) {
    for (const raw of (answers[p.id] ?? '').split(/[\n,;.…]+/)) {
      const phrase = raw.replace(/\s+/g, ' ').trim().replace(/^(and|or|i|to)\s+/i, '')
      if (phrase.length < 3 || phrase.length > 48) continue
      const key = phrase.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(phrase.charAt(0).toUpperCase() + phrase.slice(1))
      if (out.length >= 12) return out
    }
  }
  return out
}

// ---- Scoring and ranking -------------------------------------------------------------

export const SCORE_LABEL: Record<ScoreDim, { name: string; question: string }> = {
  pull: { name: 'Pull', question: 'Picture starting it tomorrow morning. How much do you want to?' },
  curiosity: { name: 'Curiosity', question: 'How much do you want to know more about it?' },
  regret: { name: 'Regret', question: 'How much would you regret never trying it?' },
  meaning: { name: 'Meaning', question: 'Does it matter beyond you?' },
  fit: { name: 'Fit', question: 'Does it use what you’re good at, or could get good at?' },
}

/** Gut signals (pull, curiosity, regret) count more than the "sensible" ones. */
const WEIGHTS: Record<ScoreDim, number> = { pull: 2, curiosity: 1.5, regret: 1.5, meaning: 1, fit: 1 }

/** 0–100 from the 1–5 scores given so far, or null if none are given. */
export function candidateScore(c: Pick<Candidate, 'scores'>): number | null {
  let sum = 0
  let weight = 0
  for (const dim of SCORE_DIMS) {
    const s = c.scores[dim]
    if (typeof s !== 'number') continue
    sum += WEIGHTS[dim] * ((Math.min(5, Math.max(1, s)) - 1) / 4)
    weight += WEIGHTS[dim]
  }
  return weight ? Math.round((sum / weight) * 100) : null
}

export const isScored = (c: Candidate) => SCORE_DIMS.every((d) => typeof c.scores[d] === 'number')

/** The final number: 60% scores, 40% head-to-head win rate (once it has duelled). */
export function fireScore(c: Candidate): number {
  const score = candidateScore(c) ?? 0
  if (!c.duels) return score
  return Math.round(score * 0.6 + (c.wins / c.duels) * 100 * 0.4)
}

/** Best first; ties keep the order they were added in. */
export function rankCandidates(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .map((c, i) => ({ c, i, s: fireScore(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c)
}

/** Every pair among the top four by score: at most six quick "only one?" choices. */
export function duelPairs(candidates: readonly Candidate[]): Array<[Candidate, Candidate]> {
  const top = candidates
    .map((c, i) => ({ c, i, s: candidateScore(c) ?? 0 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 4)
    .map((x) => x.c)
  const pairs: Array<[Candidate, Candidate]> = []
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push([top[i], top[j]])
  // Spread the pairs out so the same candidate rarely shows twice in a row.
  return pairs.sort((a, b) => pairKey(a) - pairKey(b))
}

const pairKey = (pair: [Candidate, Candidate]) => (pair[0].id + pair[1].id).length % 3

/** Apply one head-to-head pick. */
export function recordDuel(candidates: readonly Candidate[], winnerId: string, loserId: string): Candidate[] {
  return candidates.map((c) =>
    c.id === winnerId ? { ...c, wins: c.wins + 1, duels: c.duels + 1 } : c.id === loserId ? { ...c, duels: c.duels + 1 } : c,
  )
}

// ---- Reading the stored document ------------------------------------------------------

export function compassOf(docs: Docs): Compass {
  const raw = singleton<Partial<Compass>>(docs, KIND.compass, null)?.data
  return normalizeCompass(raw ?? {})
}

/** Defaults for missing or malformed fields, and the size caps (a document must stay under 32 KB). */
export function normalizeCompass(raw: Partial<Compass>): Compass {
  const base = emptyCompass()
  const answers: Record<string, string> = {}
  if (raw.answers && typeof raw.answers === 'object') {
    for (const p of COMPASS_PROMPTS) {
      const a = raw.answers[p.id]
      if (typeof a === 'string' && a) answers[p.id] = a.slice(0, MAX_ANSWER)
    }
  }
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates
        .filter((c): c is Candidate => !!c && typeof c.id === 'string' && typeof c.title === 'string')
        .slice(0, MAX_CANDIDATES)
        .map((c) => ({ id: c.id, title: c.title, scores: c.scores ?? {}, wins: c.wins || 0, duels: c.duels || 0 }))
    : base.candidates
  const fire = raw.fire && typeof raw.fire.title === 'string' ? { ...raw.fire, lengthDays: raw.fire.lengthDays || FIRE_DAYS, sparks: Array.isArray(raw.fire.sparks) ? raw.fire.sparks : [] } : null
  return { answers, candidates, fire, past: Array.isArray(raw.past) ? raw.past.slice(0, 20) : base.past }
}

// ---- The Spark experiment: numbers and verdict -----------------------------------------

export interface FireStats {
  /** Day of the experiment, 1-based, capped at its length. */
  dayN: number
  /** The experiment's days are over. */
  finished: boolean
  loggedToday: boolean
  /** Days with a check-in. */
  daysShown: number
  /** Share of the days so far with a check-in (today counts once it's logged). Null before day 2. */
  showRate: number | null
  totalMinutes: number
  sessions: number
  /** Average energy after a session, 1–5. */
  avgEnergy: number | null
  /** Second half's average energy minus the first half's (needs 4+ check-ins). */
  trend: number | null
  flowRate: number | null
  /** 0–100: energy 70%, flow 20%, showing up 10%. */
  meter: number | null
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function fireStats(fire: Fire, today: string): FireStats {
  const elapsed = daysFrom(fire.startDay, today) + 1
  const dayN = Math.max(1, Math.min(elapsed, fire.lengthDays))
  const sparks = [...fire.sparks].sort((a, b) => a.day.localeCompare(b.day))
  const lastDay = addDays(fire.startDay, fire.lengthDays - 1)
  const inWindow = sparks.filter((s) => s.day >= fire.startDay && s.day <= lastDay)
  const shownDays = new Set(inWindow.map((s) => s.day))
  const loggedToday = shownDays.has(today)
  const finished = elapsed > fire.lengthDays
  // Today only counts against you once it's over.
  const countable = finished ? fire.lengthDays : dayN - (loggedToday ? 0 : 1)
  const showRate = countable > 0 ? Math.min(1, shownDays.size / countable) : null
  const energies = sparks.map((s) => s.energy)
  const half = Math.floor(energies.length / 2)
  const trend = energies.length >= 4 ? round1(avg(energies.slice(half)) - avg(energies.slice(0, half))) : null
  const avgEnergy = energies.length ? round1(avg(energies)) : null
  const flowRate = sparks.length ? sparks.filter((s) => s.flow).length / sparks.length : null
  const meter =
    avgEnergy === null ? null : Math.round(((avgEnergy - 1) / 4) * 70 + (flowRate ?? 0) * 20 + (showRate ?? 1) * 10)
  return {
    dayN,
    finished,
    loggedToday,
    daysShown: shownDays.size,
    showRate,
    totalMinutes: sparks.reduce((n, s) => n + s.minutes, 0),
    sessions: sparks.length,
    avgEnergy,
    trend,
    flowRate,
    meter,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function meterLabel(meter: number | null): string {
  if (meter === null) return 'Not lit yet'
  if (meter >= 75) return 'Blazing'
  if (meter >= 55) return 'Burning'
  if (meter >= 30) return 'Smouldering'
  return 'Embers'
}

/**
 * What the data says. Not showing up is a starting problem, not proof the fire is wrong, so it
 * is judged first. Then: steady high energy → keep; middling → change the form, keep the theme;
 * low → test the runner-up.
 */
export function verdictOf(stats: FireStats): Verdict {
  if (stats.sessions < 3 || (stats.showRate ?? 0) < 0.4) return 'restart'
  const energy = stats.avgEnergy ?? 0
  if (energy >= 3.5 && (stats.trend ?? 0) >= -0.3) return 'keep'
  if (energy >= 2.5) return 'reshape'
  return 'switch'
}

export const VERDICT_COPY: Record<Verdict, { title: string; body: string }> = {
  keep: {
    title: 'Keep it. This is your fire.',
    body: 'You showed up and came out with energy. Run it for 30 days next, and make the output bigger and more public.',
  },
  reshape: {
    title: 'Right theme, wrong form.',
    body: 'Something here pulls you, but the daily activity doesn’t. Keep the topic and change how you do it: teach it, build it, write about it, or do it with people.',
  },
  switch: {
    title: 'Good data: not this one.',
    body: 'Two weeks of honest check-ins say this drains you. That isn’t failure; it’s one option crossed off. Test your runner-up next.',
  },
  restart: {
    title: 'Not enough data yet.',
    body: 'The problem was starting, not the fire. Rerun it at 10–15 minutes a day, right after your cue, until showing up is automatic.',
  },
}

export const ENERGY_LABEL = ['Drained', 'Flat', 'Okay', 'Good', 'Alive'] as const

/** A check-in for `day` replaces any earlier one that day. */
export function upsertSpark(sparks: readonly Spark[], spark: Spark): Spark[] {
  return [...sparks.filter((s) => s.day !== spark.day), spark].sort((a, b) => a.day.localeCompare(b.day)).slice(-60)
}

/** Hours logged as Phone / random over the 7 days ending `today`. */
export function driftHours(docs: Docs, today: string): number {
  let n = 0
  for (let i = 0; i < 7; i++) {
    for (const value of Object.values(hourLogOf(docs, addDays(today, -i)).hours)) {
      if (parseHour(value)?.category === 'phone') n++
    }
  }
  return n
}

/** Minutes of focus blocks on the fire's tile on `day`, to prefill the check-in. */
export function fireMinutesOn(docs: Docs, dumpId: string | null, day: string, now: Date): number {
  if (!dumpId) return 0
  const ms = docsOfKind<FocusSession>(docs, KIND.focus)
    .filter((d) => d.day === day && d.data.dumpId === dumpId)
    .reduce((n, d) => n + focusElapsedMs(d.data, now), 0)
  return Math.round(ms / 60_000)
}

// ---- What should I do right now? -----------------------------------------------------

export const BLOCKERS = ['tired', 'hungry', 'phone', 'restless'] as const
export type Blocker = (typeof BLOCKERS)[number]
export type Energy = 'low' | 'medium' | 'high'

export const BLOCKER_LABEL: Record<Blocker, string> = {
  tired: 'Sleepy or exhausted',
  hungry: 'Hungry',
  phone: 'Been on my phone 30+ min',
  restless: 'Restless, head too full',
}

export interface NowCandidate {
  id: string
  title: string
  type: 'block' | 'task'
  minutes: number
  firstAction: string
  dumpId: string | null
}

export interface NowInput {
  blockers: readonly Blocker[]
  energy: Energy
  /** Minutes available. */
  time: number
  fire: { title: string; firstAction: string; minutes: number; dumpId: string | null; loggedToday: boolean } | null
  /** Today's open items in queue order. */
  openItems: readonly NowCandidate[]
  /** High-priority board tiles that aren't in Today. */
  tiles: ReadonlyArray<{ id: string; title: string }>
}

export type NowKind = 'reset' | 'fire' | 'item' | 'tile' | 'discover'

export interface NowPick {
  kind: NowKind
  title: string
  /** The first two minutes, physically. */
  firstStep: string
  minutes: number
  why: string
  itemId?: string
  dumpId?: string | null
  type?: 'block' | 'task'
}

const RESETS: Record<Blocker, Omit<NowPick, 'kind'>> = {
  tired: {
    title: '20-minute power nap',
    firstStep: 'Set a 20-minute timer, lie down, eyes closed. If you can’t sleep, a 10-minute walk outside instead.',
    minutes: 20,
    why: 'Willpower runs on a rested brain. Pushing through sleepiness gives you hours of fake work.',
  },
  hungry: {
    title: 'Eat something real',
    firstStep: 'Make a 5-minute plate: eggs and toast, curd and fruit, or paneer and roti. No phone while eating.',
    minutes: 15,
    why: 'Hunger quietly turns into restlessness and scrolling. Fix the body first.',
  },
  phone: {
    title: 'Break the loop',
    firstStep: 'Put the phone in another room. Stand up, drink a full glass of water, 5 slow breaths.',
    minutes: 3,
    why: 'After a scroll session your brain wants more of the same. A physical reset breaks it in minutes.',
  },
  restless: {
    title: 'Empty your head',
    firstStep: 'Open the Dump and write every open loop, one per line, for 3 minutes.',
    minutes: 5,
    why: 'Open loops keep pulling at your attention (the Zeigarnik effect). Writing them down quiets them.',
  },
}

const RESET_ORDER: Blocker[] = ['tired', 'hungry', 'phone', 'restless']

/**
 * One reset (if something is in the way) and an ordered list of things to do, best first.
 * The UI shows only the first pick; "Something else" moves to the next one.
 *
 * - High energy: the hardest block first, then the fire.
 * - Medium: the fire first (it's the experiment), then whatever is next in Today.
 * - Low: the smallest win first, then a 10-minute version of the fire.
 * Everything is cut to the time available. With nothing to do, the answer is to find a direction.
 */
export function pickNow(input: NowInput): { reset: NowPick | null; picks: NowPick[] } {
  const blocker = RESET_ORDER.find((b) => input.blockers.includes(b))
  const reset = blocker ? { kind: 'reset' as const, ...RESETS[blocker] } : null
  const time = Math.max(5, input.time)
  const fit = (m: number) => Math.max(2, Math.min(m || 25, time))

  const fireDump = input.fire?.dumpId ?? null
  const fireItem = fireDump ? input.openItems.find((i) => i.dumpId === fireDump) : undefined
  const others = input.openItems.filter((i) => !fireDump || i.dumpId !== fireDump)
  const blocks = others.filter((i) => i.type === 'block')
  const tasks = others.filter((i) => i.type === 'task')

  const fire: NowPick | null =
    input.fire && !input.fire.loggedToday
      ? {
          kind: 'fire',
          title: input.fire.title,
          firstStep: input.fire.firstAction || 'Open what you need and do the smallest visible piece.',
          minutes: fit(input.energy === 'low' ? Math.min(10, input.fire.minutes) : input.fire.minutes),
          why:
            input.energy === 'low'
              ? 'Low energy: just 10 minutes on your fire. Small sessions still count as data.'
              : 'This is your experiment. Every session tells you whether this fire is real.',
          itemId: fireItem?.id,
          dumpId: fireDump,
          type: 'block',
        }
      : null

  const item = (i: NowCandidate, why: string, minutes = i.minutes): NowPick => ({
    kind: 'item',
    title: i.title,
    firstStep: i.firstAction || (i.type === 'block' ? 'Open the material and do the first small piece.' : 'Start the first physical step.'),
    minutes: i.type === 'block' ? fit(minutes) : Math.min(15, time),
    why,
    itemId: i.id,
    dumpId: i.dumpId,
    type: i.type,
  })

  const tile = (t: { id: string; title: string }): NowPick => ({
    kind: 'tile',
    title: t.title,
    firstStep: 'Decide the very first physical step, then do it.',
    minutes: Math.min(25, time),
    why: 'You marked this high priority on your board.',
    dumpId: t.id,
  })

  const ordered: Array<NowPick | null> = []
  if (input.energy === 'high') {
    ordered.push(
      ...blocks.slice(0, 1).map((b) => item(b, 'Your best energy goes to the hardest thing on your list.')),
      fire,
      ...blocks.slice(1).map((b) => item(b, 'Next block in your queue.')),
      ...input.tiles.map(tile),
      ...tasks.map((t) => item(t, 'Next in your queue.')),
    )
  } else if (input.energy === 'medium') {
    ordered.push(
      fire,
      ...others.map((i) => item(i, 'Next in your queue. Start with the first step and let momentum take over.')),
      ...input.tiles.map(tile),
    )
  } else {
    ordered.push(
      ...tasks.slice(0, 1).map((t) => item(t, 'Low energy: win something small first. Momentum does the rest.')),
      fire,
      ...blocks.slice(0, 1).map((b) => item(b, 'Low energy: just the 10-minute version. Stopping after is allowed.', 10)),
      ...tasks.slice(1).map((t) => item(t, 'Another small win.')),
      ...input.tiles.map(tile),
    )
  }
  const picks = ordered.filter((p): p is NowPick => !!p)
  if (!input.fire) {
    picks.push({
      kind: 'discover',
      title: 'Find your fire',
      firstStep: 'Answer the first question honestly. Write fast; don’t polish.',
      minutes: 20,
      why: picks.length
        ? 'Or: spend 20 minutes on the bigger question, what you actually want to be doing.'
        : 'Nothing is waiting, and no direction is set. Finding one is the most useful 20 minutes you can spend right now.',
    })
  }
  return { reset, picks }
}
