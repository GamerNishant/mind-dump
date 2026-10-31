import { describe, expect, it } from 'vitest'
import { FIRE_DAYS, type Candidate, type Fire, type Spark } from '@/domain/plan'
import {
  candidateScore,
  duelPairs,
  fireScore,
  fireStats,
  normalizeCompass,
  pickNow,
  rankCandidates,
  recordDuel,
  suggestCandidates,
  upsertSpark,
  verdictOf,
  type NowInput,
} from './compass'
import { addDays } from './plan'

const cand = (id: string, s: number, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  title: id,
  scores: { pull: s, curiosity: s, regret: s, meaning: s, fit: s },
  wins: 0,
  duels: 0,
  ...extra,
})

const start = '2026-10-01'
const fire = (sparks: Spark[], fields: Partial<Fire> = {}): Fire => ({
  title: 'Make history videos',
  why: '',
  output: '3 videos',
  minutes: 25,
  firstAction: 'Write the hook',
  cue: '',
  startDay: start,
  lengthDays: FIRE_DAYS,
  dumpId: 'd1',
  runnerUp: 'Teach polity',
  sparks,
  ...fields,
})
const spark = (i: number, energy: number, flow = false): Spark => ({ day: addDays(start, i), minutes: 25, energy, flow, note: '' })

describe('candidate scoring', () => {
  it('maps 1–5 scores onto 0–100, with gut signals weighted higher', () => {
    expect(candidateScore(cand('a', 1))).toBe(0)
    expect(candidateScore(cand('a', 5))).toBe(100)
    expect(candidateScore({ scores: {} })).toBeNull()
    const gut = candidateScore({ scores: { pull: 5, curiosity: 5, regret: 5, meaning: 1, fit: 1 } })!
    const sensible = candidateScore({ scores: { pull: 1, curiosity: 1, regret: 1, meaning: 5, fit: 5 } })!
    expect(gut).toBeGreaterThan(sensible)
  })

  it('blends in head-to-head wins and ranks best first', () => {
    const a = cand('a', 4)
    const b = cand('b', 4)
    let list = recordDuel([a, b], 'b', 'a')
    expect(list.find((c) => c.id === 'b')).toMatchObject({ wins: 1, duels: 1 })
    expect(list.find((c) => c.id === 'a')).toMatchObject({ wins: 0, duels: 1 })
    expect(rankCandidates(list).map((c) => c.id)).toEqual(['b', 'a'])
    list = recordDuel(list, 'a', 'b')
    expect(fireScore(list[0])).toBe(fireScore(list[1]))
    // A tie keeps the order they were added in.
    expect(rankCandidates(list).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('duels every pair among the top four only', () => {
    const list = [cand('a', 5), cand('b', 4), cand('c', 3), cand('d', 2), cand('e', 1)]
    const pairs = duelPairs(list)
    expect(pairs).toHaveLength(6)
    expect(pairs.flat().some((c) => c.id === 'e')).toBe(false)
    expect(duelPairs([cand('a', 3), cand('b', 3)])).toHaveLength(1)
  })
})

describe('suggestCandidates', () => {
  it('pulls short distinct phrases out of the answers', () => {
    const out = suggestCandidates({ flow: 'Editing videos, explaining history.\nediting videos', kid: 'and drawing maps; x' }, ['Drawing maps'])
    expect(out).toEqual(['Editing videos', 'Explaining history'])
  })
})

describe('fire stats and verdict', () => {
  it('counts days, showing up, energy, flow and the meter', () => {
    const f = fire([spark(0, 3, true), spark(1, 4), spark(3, 5, true)])
    const s = fireStats(f, addDays(start, 4)) // day 5, today not logged yet
    expect(s).toMatchObject({ dayN: 5, finished: false, loggedToday: false, daysShown: 3, sessions: 3, totalMinutes: 75, avgEnergy: 4 })
    expect(s.showRate).toBe(3 / 4)
    expect(s.flowRate).toBeCloseTo(2 / 3)
    expect(s.meter).toBe(Math.round(0.75 * 70 + (2 / 3) * 20 + 0.75 * 10))
    expect(s.trend).toBeNull()
  })

  it('does not count today against you until it is over', () => {
    expect(fireStats(fire([]), start).showRate).toBeNull()
    expect(fireStats(fire([spark(0, 3)]), start).showRate).toBe(1)
  })

  it('reports a trend from the second half against the first', () => {
    const s = fireStats(fire([spark(0, 2), spark(1, 2), spark(2, 4), spark(3, 4)]), addDays(start, 3))
    expect(s.trend).toBe(2)
  })

  it('finishes after its days and gives a verdict', () => {
    const end = addDays(start, FIRE_DAYS)
    const all = (energy: number) => fire(Array.from({ length: 12 }, (_, i) => spark(i, energy, energy > 3)))
    expect(fireStats(all(4), end).finished).toBe(true)
    expect(verdictOf(fireStats(all(4), end))).toBe('keep')
    expect(verdictOf(fireStats(all(3), end))).toBe('reshape')
    expect(verdictOf(fireStats(all(2), end))).toBe('switch')
    // Barely showed up: that's a starting problem, whatever the energy.
    expect(verdictOf(fireStats(fire([spark(0, 5), spark(1, 5), spark(2, 5)]), end))).toBe('restart')
  })

  it('keeps one check-in per day', () => {
    const list = upsertSpark([spark(0, 2)], { ...spark(0, 5) })
    expect(list).toHaveLength(1)
    expect(list[0].energy).toBe(5)
  })

  it('normalises a damaged document', () => {
    const c = normalizeCompass({ answers: { flow: 'x'.repeat(2000), bogus: 'y' } as Record<string, string>, candidates: [null as unknown as Candidate] })
    expect(c.answers.flow).toHaveLength(600)
    expect(c.answers).not.toHaveProperty('bogus')
    expect(c.candidates).toEqual([])
    expect(c.fire).toBeNull()
  })
})

describe('pickNow', () => {
  const base: NowInput = {
    blockers: [],
    energy: 'medium',
    time: 60,
    fire: { title: 'Fire', firstAction: 'Hook', minutes: 25, dumpId: 'f', loggedToday: false },
    openItems: [
      { id: 't1', title: 'Pay bill', type: 'task', minutes: 50, firstAction: '', dumpId: 'x' },
      { id: 'b1', title: 'Polity', type: 'block', minutes: 50, firstAction: 'Ch. 4', dumpId: 'y' },
      { id: 'fi', title: 'Fire', type: 'block', minutes: 25, firstAction: '', dumpId: 'f' },
    ],
    tiles: [{ id: 'z', title: 'Call bank' }],
  }

  it('fixes the body first', () => {
    const { reset } = pickNow({ ...base, blockers: ['phone', 'hungry'] })
    expect(reset?.title).toBe('Eat something real')
  })

  it('high energy: hardest block first, then the fire (linked to its Today item)', () => {
    const { picks } = pickNow({ ...base, energy: 'high' })
    expect(picks.map((p) => p.title).slice(0, 2)).toEqual(['Polity', 'Fire'])
    expect(picks[1]).toMatchObject({ kind: 'fire', itemId: 'fi' })
    // The fire's own Today item is not listed twice.
    expect(picks.filter((p) => p.title === 'Fire')).toHaveLength(1)
  })

  it('medium: the fire first; low: a small win, then a 10-minute fire', () => {
    expect(pickNow(base).picks[0].kind).toBe('fire')
    const low = pickNow({ ...base, energy: 'low' }).picks
    expect(low[0].title).toBe('Pay bill')
    expect(low[1]).toMatchObject({ kind: 'fire', minutes: 10 })
  })

  it('cuts to the time available and skips a fire already logged', () => {
    const { picks } = pickNow({ ...base, energy: 'high', time: 15, fire: { ...base.fire!, loggedToday: true } })
    expect(picks[0]).toMatchObject({ title: 'Polity', minutes: 15 })
    expect(picks.some((p) => p.kind === 'fire')).toBe(false)
  })

  it('with nothing to do and no direction, the answer is to find one', () => {
    const { picks } = pickNow({ ...base, fire: null, openItems: [], tiles: [] })
    expect(picks).toHaveLength(1)
    expect(picks[0].kind).toBe('discover')
  })
})
