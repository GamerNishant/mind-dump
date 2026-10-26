import { describe, expect, it } from 'vitest'
import type { PlannerDoc } from '@/domain/planner'
import { emptyDayPlan, KIND, type TileMeta, type TodayItem } from '@/domain/plan'
import {
  addDays,
  capUsage,
  coveredHours,
  daysFrom,
  floorDots,
  floorMet,
  focusRemainingMs,
  formatClock,
  hasRoomFor,
  newItem,
  planDay,
  planRollover,
  routineItemId,
  stableId,
  weekdayOf,
  type Docs,
} from './plan'

const item = (id: string, day: string, fields: Partial<TodayItem> = {}): PlannerDoc<TodayItem> => ({
  id,
  kind: KIND.todayItem,
  day,
  data: newItem({ title: id, order: 0, ...fields }),
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
})

const meta = (dumpId: string, fields: Partial<TileMeta>): PlannerDoc<TileMeta> => ({
  id: dumpId,
  kind: KIND.tileMeta,
  day: null,
  data: {
    dumpId,
    repeat: null,
    defaultType: 'task',
    defaultMinutes: 50,
    habit: false,
    resumeNote: '',
    defaultMinimum: '',
    skipCount: 0,
    carryCount: 0,
    priority: null,
    ...fields,
  },
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
})

const docsOf = (...docs: PlannerDoc[]): Docs => new Map(docs.map((d) => [d.id, d]))

describe('planner days', () => {
  it('starts the day at the configured hour', () => {
    expect(planDay(new Date(2026, 9, 18, 2, 59))).toBe('2026-10-17')
    expect(planDay(new Date(2026, 9, 18, 3, 0))).toBe('2026-10-18')
    expect(planDay(new Date(2026, 9, 18, 23, 30))).toBe('2026-10-18')
    expect(planDay(new Date(2026, 9, 18, 0, 30), 0)).toBe('2026-10-18')
  })

  it('does date arithmetic across months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(daysFrom('2026-10-18', '2026-10-25')).toBe(7)
    expect(weekdayOf('2026-10-18')).toBe(0) // a Sunday
  })
})

describe('stableId', () => {
  it('is deterministic, distinct per input, and UUID-shaped', () => {
    const a = stableId('day_plan', '2026-10-18')
    expect(a).toBe(stableId('day_plan', '2026-10-18'))
    expect(a).not.toBe(stableId('day_plan', '2026-10-19'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('queue caps', () => {
  const settings = { blockCap: 2, taskCap: 2, dayStartHour: 3, rulesSeeded: true, otherTags: [] }
  it('counts open and done items, but not skipped ones or habits', () => {
    const items = [
      item('a', 'd', { type: 'block' }),
      item('b', 'd', { type: 'block', status: 'done' }),
      item('c', 'd', { type: 'block', status: 'skipped' }),
      item('d', 'd', { type: 'task', habit: true }),
      item('e', 'd', { type: 'task' }),
    ]
    expect(capUsage(items)).toEqual({ blocks: 2, tasks: 1 })
    expect(hasRoomFor('block', items, settings)).toBe(false)
    expect(hasRoomFor('task', items, settings)).toBe(true)
  })
})

describe('Floor', () => {
  it('needs one block with its minimum met plus shutdown', () => {
    const plan = { ...emptyDayPlan(), shutdownAt: '2026-10-18T19:15:00Z' }
    const done = item('a', 'd', { type: 'block', status: 'done', minMet: true })
    expect(floorMet([done], plan)).toBe(true)
    expect(floorMet([done], emptyDayPlan())).toBe(false)
    expect(floorMet([item('t', 'd', { type: 'task', status: 'done', minMet: true })], plan)).toBe(false)
  })

  it('builds 7 dots ending today', () => {
    const plan: PlannerDoc = {
      id: stableId(KIND.dayPlan, '2026-10-17'),
      kind: KIND.dayPlan,
      day: '2026-10-17',
      data: { ...emptyDayPlan(), shutdownAt: 'x' },
      createdAt: '',
      updatedAt: '',
    }
    const docs = docsOf(plan, item('a', '2026-10-17', { type: 'block', status: 'done', minMet: true }))
    const dots = floorDots(docs, '2026-10-18', emptyDayPlan)
    expect(dots.map((d) => d.state)).toEqual(['miss', 'miss', 'miss', 'miss', 'miss', 'hit', 'today'])
    expect(dots[0].day).toBe('2026-10-12')
  })
})

describe('planRollover', () => {
  const today = '2026-10-18' // Sunday

  it("carries yesterday's open items to the end of today, counting carries", () => {
    const docs = docsOf(
      item('y-open', '2026-10-17', { dumpId: 'd1', carryCount: 2 }),
      item('y-done', '2026-10-17', { status: 'done' }),
      item('t', today, { order: 5000 }),
    )
    const { updates, creates, stale } = planRollover({ docs, today, activeDumps: [] })
    const carried = updates.find((u) => u.id === 'y-open')!
    expect(carried.day).toBe(today)
    expect(carried.data).toMatchObject({ carriedFrom: '2026-10-17', carryCount: 3 })
    expect((carried.data as TodayItem).order).toBeGreaterThan(5000)
    expect(updates.find((u) => u.id === 'y-done')).toBeUndefined()
    expect(updates.find((u) => u.kind === KIND.tileMeta)?.data).toMatchObject({ dumpId: 'd1', carryCount: 3 })
    expect(creates).toEqual([])
    expect(stale).toEqual([])
  })

  it('closes unfinished routines instead of carrying them, and reports older items as stale', () => {
    const docs = docsOf(
      item('routine', '2026-10-17', { routine: true }),
      item('old', '2026-10-10'),
      item('future', '2026-10-19'),
    )
    const { updates, stale } = planRollover({ docs, today, activeDumps: [] })
    expect(updates.find((u) => u.id === 'routine')?.data).toMatchObject({ status: 'skipped' })
    expect(updates.find((u) => u.id === 'old')).toBeUndefined()
    expect(updates.find((u) => u.id === 'future')).toBeUndefined()
    expect(stale.map((s) => s.id)).toEqual(['old'])
  })

  it('creates routine items for tiles due today, once', () => {
    const docs = docsOf(
      meta('gym', { repeat: [0, 6], defaultType: 'block', defaultMinutes: 90, resumeNote: 'set 3' }),
      meta('weekday', { repeat: [1, 2, 3, 4, 5] }),
      meta('cleared', { repeat: [0] }),
      item('first', today, { order: 0 }),
    )
    const dumps = [
      { id: 'gym', content: 'Gym\nlegs day' },
      { id: 'weekday', content: 'Newspaper' },
    ]
    const { creates } = planRollover({ docs, today, activeDumps: dumps })
    expect(creates).toHaveLength(1)
    expect(creates[0].id).toBe(routineItemId('gym', today))
    expect(creates[0].data).toMatchObject({ title: 'Gym', type: 'block', minutes: 90, routine: true, firstAction: 'Resume: set 3' })
    expect((creates[0].data as TodayItem).order).toBeLessThan(0)

    const after = docsOf(...docs.values(), { ...creates[0], createdAt: '', updatedAt: '' } as PlannerDoc)
    expect(planRollover({ docs: after, today, activeDumps: dumps }).creates).toEqual([])
  })
})

describe('hours and focus', () => {
  it('fills every hour a session spent 10+ minutes in', () => {
    const covered = coveredHours(new Date(2026, 9, 18, 4, 10), new Date(2026, 9, 18, 6, 20), 3)
    expect(covered.map((c) => c.hour)).toEqual([4, 5, 6])
    // 6:05 is only 5 minutes into hour 6: not counted.
    expect(coveredHours(new Date(2026, 9, 18, 4, 10), new Date(2026, 9, 18, 6, 5), 3).map((c) => c.hour)).toEqual([4, 5])
  })

  it('a 50-minute block across the hour fills both hours', () => {
    expect(coveredHours(new Date(2026, 9, 18, 10, 35), new Date(2026, 9, 18, 11, 25), 3)).toEqual([
      { day: '2026-10-18', hour: 10 },
      { day: '2026-10-18', hour: 11 },
    ])
  })

  it('a short block split by the hour still fills the hour it spent most time in', () => {
    expect(coveredHours(new Date(2026, 9, 18, 10, 52), new Date(2026, 9, 18, 11, 0), 3)).toEqual([{ day: '2026-10-18', hour: 10 }])
    expect(coveredHours(new Date(2026, 9, 18, 10, 58), new Date(2026, 9, 18, 11, 1), 3)).toEqual([]) // under 5 minutes
  })

  it('a block across the day boundary fills hours on both planner days', () => {
    expect(coveredHours(new Date(2026, 9, 18, 2, 30), new Date(2026, 9, 18, 3, 20), 3)).toEqual([
      { day: '2026-10-17', hour: 2 },
      { day: '2026-10-18', hour: 3 },
    ])
  })

  it('computes remaining time excluding pauses', () => {
    const session = {
      itemId: null,
      dumpId: null,
      title: '',
      firstAction: '',
      minimum: '',
      plannedMin: 50,
      starter: false,
      startedAt: '2026-10-18T04:00:00Z',
      pausedAt: null,
      pausedMs: 5 * 60_000,
      endedAt: null,
      minMet: null,
      stoppedAt: '',
    }
    expect(focusRemainingMs(session, new Date('2026-10-18T04:30:00Z'))).toBe(25 * 60_000)
    expect(formatClock(25 * 60_000)).toBe('25:00')
    expect(formatClock(90 * 60_000 + 1)).toBe('1:30:01')
  })
})
