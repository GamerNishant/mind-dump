import { describe, expect, it } from 'vitest'
import type { Dump } from '@/domain/dump'
import { ageTone, daysBetween, pendingLabel } from './days'
import { planMove, positionBetween, POSITION_STEP, rebalance, topPosition } from './position'
import { matchesQuery, sortDumps } from './sort'
import { preview, splitLines } from './text'

const dump = (id: string, content: string, position: number, createdAt: string): Dump => ({
  id,
  content,
  position,
  status: 'active',
  createdAt,
  updatedAt: createdAt,
  completedAt: null,
})

describe('daysBetween', () => {
  it('counts calendar days, not 24h periods', () => {
    expect(daysBetween(new Date(2026, 9, 16, 23, 59), new Date(2026, 9, 17, 0, 1))).toBe(1)
    expect(daysBetween(new Date(2026, 9, 17, 0, 1), new Date(2026, 9, 17, 23, 59))).toBe(0)
  })

  it('handles month boundaries and never goes negative', () => {
    expect(daysBetween(new Date(2026, 8, 28), new Date(2026, 9, 3))).toBe(5)
    expect(daysBetween(new Date(2026, 9, 18), new Date(2026, 9, 17))).toBe(0)
  })

  it('accepts ISO strings', () => {
    const created = new Date(2026, 9, 10, 12).toISOString()
    expect(daysBetween(created, new Date(2026, 9, 17, 12))).toBe(7)
  })
})

describe('pending labels and tones', () => {
  it('labels days', () => {
    expect(pendingLabel(0)).toBe('Today')
    expect(pendingLabel(1)).toBe('1 day')
    expect(pendingLabel(12)).toBe('12 days')
  })

  it('escalates tone with age', () => {
    expect([0, 2, 3, 6, 7, 13, 14, 90].map(ageTone)).toEqual([
      'fresh', 'fresh', 'warm', 'warm', 'hot', 'hot', 'stale', 'stale',
    ])
  })
})

describe('sortDumps', () => {
  const items = [
    dump('a', 'banana', 2, '2026-10-02T10:00:00.000Z'),
    dump('b', 'Apple pie recipe', 0, '2026-10-05T10:00:00.000Z'),
    dump('c', 'item 10', 1, '2026-10-01T10:00:00+00:00'),
    dump('d', 'item 9', 3, '2026-10-03T10:00:00.000Z'),
  ]
  const ids = (list: Dump[]) => list.map((d) => d.id).join('')

  it('custom uses position', () => expect(ids(sortDumps(items, 'custom'))).toBe('bcad'))
  it('newest / oldest use created time (mixed ISO formats)', () => {
    expect(ids(sortDumps(items, 'newest'))).toBe('bdac')
    expect(ids(sortDumps(items, 'oldest'))).toBe('cadb')
  })
  it('a→z is case-insensitive and numeric-aware', () => {
    expect(ids(sortDumps(items, 'az'))).toBe('badc')
    expect(ids(sortDumps(items, 'za'))).toBe('cdab')
  })
  it('length sorts', () => {
    expect(ids(sortDumps(items, 'shortest'))).toBe('adcb') // banana and 'item 9' tie on length → position decides
    expect(ids(sortDumps(items, 'longest'))).toBe('bcad')
  })
  it('does not mutate input', () => {
    const copy = [...items]
    sortDumps(items, 'az')
    expect(items).toEqual(copy)
  })
  it('matchesQuery is case-insensitive and empty matches all', () => {
    expect(matchesQuery(items[1], 'APPLE')).toBe(true)
    expect(matchesQuery(items[1], '  ')).toBe(true)
    expect(matchesQuery(items[1], 'kiwi')).toBe(false)
  })
})

describe('positions', () => {
  it('positionBetween', () => {
    expect(positionBetween(undefined, undefined)).toBe(0)
    expect(positionBetween(undefined, 10)).toBe(10 - POSITION_STEP)
    expect(positionBetween(10, undefined)).toBe(10 + POSITION_STEP)
    expect(positionBetween(0, 1)).toBe(0.5)
  })

  it('topPosition goes above the minimum', () => {
    expect(topPosition([])).toBe(0)
    expect(topPosition([{ id: 'a', position: 5 }, { id: 'b', position: -3 }])).toBe(-3 - POSITION_STEP)
  })

  it('planMove writes a single row when there is room', () => {
    const ordered = [{ id: 'a', position: 0 }, { id: 'm', position: 9999 }, { id: 'b', position: 1024 }]
    expect(planMove(ordered, 1)).toEqual([{ id: 'm', position: 512 }])
    const toTop = [{ id: 'a', position: 5000 }, { id: 'm', position: 0 }, { id: 'b', position: 1024 }]
    expect(planMove(toTop, 0)).toEqual([{ id: 'a', position: -POSITION_STEP }])
  })

  it('planMove rebalances when neighbours are too close or equal', () => {
    const ordered = [{ id: 'a', position: 1 }, { id: 'm', position: 50 }, { id: 'b', position: 1 }]
    expect(planMove(ordered, 1)).toEqual(rebalance(ordered))
  })

  it('repeated bisection eventually triggers a rebalance instead of colliding', () => {
    let lo = 0
    const hi = 1
    let rebalanced = false
    for (let i = 0; i < 80 && !rebalanced; i++) {
      const plan = planMove([{ id: 'lo', position: lo }, { id: 'x', position: 0 }, { id: 'hi', position: hi }], 1)
      if (plan.length > 1) rebalanced = true
      else lo = plan[0].position
    }
    expect(rebalanced).toBe(true)
  })
})

describe('text helpers', () => {
  it('splitLines strips list markers and blanks', () => {
    expect(splitLines('- milk\n* eggs\n\n• bread\n1. jam\n2) tea\n[ ] call mom\n[x] done\nplain')).toEqual([
      'milk', 'eggs', 'bread', 'jam', 'tea', 'call mom', 'done', 'plain',
    ])
  })
  it('splitLines keeps hyphenated words', () => {
    expect(splitLines('-5 degrees\nre-check')).toEqual(['-5 degrees', 're-check'])
  })
  it('preview collapses whitespace and truncates', () => {
    expect(preview('  a\n\nb  ')).toBe('a b')
    expect(preview('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
