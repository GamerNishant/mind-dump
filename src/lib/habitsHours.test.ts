import { describe, expect, it } from 'vitest'
import type { PlannerDoc } from '@/domain/planner'
import { EVERY_DAY, KIND, type Habit, type HourLog } from '@/domain/plan'
import type { Dump } from '@/domain/dump'
import { bestStreak, consistency, currentStreak, daysLabel, habitCells, habitsOf, missedLast, normalizeHabit, toggleDone } from './habits'
import { cleanTag, hourValue, mergeTags, parseHour, summarize, weekOf, weekSummary } from './hours'
import { hourLogId, weekdayOf, type Docs } from './plan'
import { QUOTES, quoteOfDay } from './quotes'
import { sortDumps } from './sort'

const habit = (fields: Partial<Habit> = {}): Habit => ({ name: 'Read', days: [...EVERY_DAY], done: [], order: 0, startDay: '2026-10-01', ...fields })

describe('habits', () => {
  // 2026-10-20 is a Tuesday.
  const today = '2026-10-20'

  it('counts a streak back from today, and an unfinished today does not break it', () => {
    const h = habit({ done: ['2026-10-17', '2026-10-18', '2026-10-19'] })
    expect(currentStreak(h, today)).toBe(3)
    expect(currentStreak({ ...h, done: [...h.done, today] }, today)).toBe(4)
  })

  it('breaks the streak on a missed due day but skips rest days', () => {
    expect(currentStreak(habit({ done: ['2026-10-16', '2026-10-19'] }), today)).toBe(1)
    // Weekdays only: Fri 16 and Mon 19 done, the weekend is rest.
    const weekdays = habit({ days: [1, 2, 3, 4, 5], done: ['2026-10-16', '2026-10-19'] })
    expect(currentStreak(weekdays, today)).toBe(2)
  })

  it('tracks the best streak', () => {
    const h = habit({ done: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-10', '2026-10-19'] })
    expect(bestStreak(h, today)).toBe(3)
    expect(bestStreak(habit(), today)).toBe(0)
  })

  it('measures consistency over due days since the start, counting today only once done', () => {
    const h = habit({ startDay: '2026-10-17', done: ['2026-10-17', '2026-10-19'] })
    expect(consistency(h, today)).toEqual({ done: 2, due: 3, percent: 67 })
    expect(consistency({ ...h, done: [...h.done, today] }, today)).toEqual({ done: 3, due: 4, percent: 75 })
    expect(consistency(habit({ startDay: today }), today)).toBeNull()
  })

  it('labels cells and flags "never miss twice"', () => {
    const h = habit({ days: [1, 2, 3, 4, 5], startDay: '2026-10-15', done: ['2026-10-15'] })
    const states = habitCells(h, '2026-10-14', '2026-10-21', today).map((c) => c.state)
    // Wed 14 before start, Thu 15 done, Fri 16 missed, Sat/Sun rest, Mon 19 missed, Tue 20 today, Wed 21 future.
    expect(states).toEqual(['before', 'done', 'missed', 'rest', 'rest', 'missed', 'today', 'future'])
    expect(missedLast(h, today)).toBe(true)
    expect(missedLast({ ...h, done: [...h.done, '2026-10-19'] }, today)).toBe(false)
  })

  it('toggles a day and normalizes bad data', () => {
    const h = habit({ done: ['2026-10-19'] })
    expect(toggleDone(h, today)).toEqual(['2026-10-19', today])
    expect(toggleDone(h, '2026-10-19')).toEqual([])
    const n = normalizeHabit({ name: '', days: [9, 1, 1], done: ['2026-10-02', '2026-10-01', '2026-10-02'] })
    expect(n).toMatchObject({ name: 'Habit', days: [1], done: ['2026-10-01', '2026-10-02'], startDay: '2026-10-01' })
    expect(normalizeHabit({}).days).toEqual(EVERY_DAY)
  })

  it('names schedules', () => {
    expect(daysLabel(EVERY_DAY)).toBe('Daily')
    expect(daysLabel([5, 4, 3, 2, 1])).toBe('Weekdays')
    expect(daysLabel([0, 6])).toBe('Weekends')
    expect(daysLabel([0, 1, 3])).toBe('Mon Wed Sun')
  })

  it('reads habits from docs in stack order', () => {
    const doc = (id: string, order: number): PlannerDoc => ({ id, kind: KIND.habit, day: null, data: habit({ name: id, order }), createdAt: '', updatedAt: '' })
    const docs: Docs = new Map([['b', doc('b', 2048)], ['a', doc('a', 0)]])
    expect(habitsOf(docs).map((h) => h.id)).toEqual(['a', 'b'])
  })
})

describe('hour tags and weekly summary', () => {
  it('parses values, keeping named Other hours', () => {
    expect(parseHour('study')).toEqual({ category: 'study', tag: null })
    expect(parseHour('other:Gym')).toEqual({ category: 'other', tag: 'Gym' })
    expect(parseHour('other:  ')).toEqual({ category: 'other', tag: null })
    expect(parseHour('mystery')).toEqual({ category: 'other', tag: null })
    expect(parseHour(undefined)).toBeNull()
  })

  it('stores a name as Other, unless it is really a built-in category', () => {
    expect(hourValue('other', '  Gym   time ')).toBe('other:Gym time')
    expect(hourValue('other', 'sleep')).toBe('sleep')
    expect(hourValue('other', 'Phone / random')).toBe('phone')
    expect(hourValue('other', '')).toBe('other')
    expect(hourValue('study', 'ignored')).toBe('study')
    expect(cleanTag('x'.repeat(40))).toHaveLength(24)
  })

  it('merges tags case-insensitively', () => {
    expect(mergeTags(['Gym'], ['gym', ' Travel ', ''])).toEqual(['Gym', 'Travel'])
  })

  it('rolls named Other hours up under Other with a breakdown', () => {
    const logs: HourLog[] = [
      { hours: { '6': 'study', '7': 'study', '8': 'other:Gym' } },
      { hours: { '9': 'other:Gym', '10': 'other:Travel', '11': 'other' } },
    ]
    expect(summarize(logs)).toEqual([
      { category: 'other', hours: 4, tags: [{ tag: 'Gym', hours: 2 }, { tag: 'Travel', hours: 1 }] },
      { category: 'study', hours: 2, tags: [] },
    ])
  })

  it('builds Monday-to-Sunday weeks', () => {
    const week = weekOf('2026-10-20')
    expect(week[0]).toBe('2026-10-19')
    expect(week[6]).toBe('2026-10-25')
    expect(weekdayOf(week[0])).toBe(1)
    expect(weekOf('2026-10-25')[0]).toBe('2026-10-19') // Sunday belongs to the week before it
    expect(weekOf('2026-10-20', -1)[0]).toBe('2026-10-12')
  })

  it('summarizes a week from the hour-log docs', () => {
    const log = (day: string, hours: HourLog['hours']): [string, PlannerDoc] => [
      hourLogId('u', day),
      { id: hourLogId('u', day), kind: KIND.hourLog, day, data: { hours }, createdAt: '', updatedAt: '' },
    ]
    const docs: Docs = new Map([log('2026-10-19', { '5': 'study', '6': 'phone' }), log('2026-10-21', { '5': 'study' }), log('2026-10-12', { '5': 'sleep' })])
    const week = weekSummary(docs, weekOf('2026-10-20'))
    expect(week.logged).toBe(3)
    expect(week.activeDays).toBe(2)
    expect(week.totals[0]).toMatchObject({ category: 'study', hours: 2 })
    expect(week.days[0].segments.map((s) => s.category)).toEqual(['study', 'phone'])
  })
})

describe('quotes', () => {
  it('gives a stable quote per day that changes day to day', () => {
    expect(quoteOfDay('2026-10-20')).toBe(quoteOfDay('2026-10-20'))
    expect(quoteOfDay('2026-10-20')).not.toBe(quoteOfDay('2026-10-21'))
    expect(QUOTES.length).toBeGreaterThanOrEqual(30)
    expect(quoteOfDay('1999-01-01')).toBeDefined()
  })
})

describe('priority sort', () => {
  const dump = (id: string, position: number): Dump => ({
    id,
    content: id,
    position,
    status: 'active',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    completedAt: null,
  })
  it('puts high first and unset last, keeping My order within a level', () => {
    const priorities: Record<string, 'high' | 'medium' | 'low' | undefined> = { a: undefined, b: 'low', c: 'high', d: 'high', e: 'medium' }
    const sorted = sortDumps([dump('a', 0), dump('b', 1), dump('c', 3), dump('d', 2), dump('e', 4)], 'priority', (id) => priorities[id])
    expect(sorted.map((d) => d.id)).toEqual(['d', 'c', 'e', 'b', 'a'])
  })
})
