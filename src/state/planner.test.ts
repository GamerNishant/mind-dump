import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS, KIND, SEED_RULES, type FocusSession, type TodayItem } from '@/domain/plan'
import { hourLogOf, itemsForDay } from '@/lib/plan'
import { DumpsStore } from './dumpsStore'
import { Planner } from './planner'
import { PlannerStore } from './plannerStore'

async function setup() {
  const backend = createLocalBackend(memoryStore(), { iterations: 10 })
  await backend.auth.signUp({ email: 'a@example.com', password: 'password1', displayName: 'A' })
  const user = (await backend.auth.currentUser())!
  const dumps = new DumpsStore(backend.dumps(user.id))
  await dumps.loadActive()
  const store = new PlannerStore(backend.planner(user.id), ALL_KINDS, () => '2000-01-01')
  await store.load()
  const planner = new Planner(store, dumps)
  return { dumps, store, planner, day: planner.today() }
}

const today = (ctx: Awaited<ReturnType<typeof setup>>) => itemsForDay(ctx.store.getState().docs, ctx.day)

describe('Planner', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('adds a dump tile to Today once; the tile stays on the board', async () => {
    await ctx.dumps.add(['Read PSIR Plato\nchapter 3'])
    const dump = ctx.dumps.getState().active[0]
    expect(await ctx.planner.addFromDump(dump)).toMatchObject({ ok: true })
    expect(await ctx.planner.addFromDump(dump)).toEqual({ ok: false, reason: 'exists' })
    expect(today(ctx).map((i) => i.data.title)).toEqual(['Read PSIR Plato'])
    expect(ctx.dumps.getState().active).toHaveLength(1)
  })

  it('enforces the block cap and remembers the type per tile', async () => {
    await ctx.dumps.add(['a', 'b', 'c'])
    const [a, b, c] = ctx.dumps.getState().active
    for (const d of [a, b, c]) await ctx.planner.addFromDump(d)
    const [ia, ib, ic] = today(ctx)
    expect(await ctx.planner.updateItem(ia.id, { type: 'block', minutes: 90 })).toBe(true)
    expect(await ctx.planner.updateItem(ib.id, { type: 'block' })).toBe(true)
    expect(await ctx.planner.updateItem(ic.id, { type: 'block' })).toBe(false) // cap 2
    expect(ctx.planner.tileMeta(a.id)).toMatchObject({ defaultType: 'block', defaultMinutes: 90 })
  })

  it('typing a task in Today also creates its dump tile', async () => {
    const result = await ctx.planner.addText('Call the bank', 'task')
    expect(result.ok).toBe(true)
    expect(ctx.dumps.getState().active.map((d) => d.content)).toEqual(['Call the bank'])
    expect(today(ctx)[0].data.dumpId).toBe(ctx.dumps.getState().active[0].id)
  })

  it('skips need a reason and a destination', async () => {
    await ctx.dumps.add(['x', 'y'])
    for (const d of ctx.dumps.getState().active) await ctx.planner.addFromDump(d)
    const [first, second] = today(ctx)

    await ctx.planner.skip(first.id, 'too_big', 'later')
    expect(today(ctx).map((i) => i.id)).toEqual([second.id, first.id])

    await ctx.planner.skip(second.id, 'phone', 'tomorrow')
    expect(today(ctx).map((i) => i.id)).toEqual([first.id])
    const tomorrow = itemsForDay(ctx.store.getState().docs, ctx.planner.today(new Date(Date.now() + 86_400_000)))
    expect(tomorrow.map((i) => i.id)).toEqual([second.id])

    await ctx.planner.skip(first.id, 'didnt_want', 'dump')
    const skipped = today(ctx)[0].data
    expect(skipped.status).toBe('skipped')
    expect(skipped.skips.map((s) => s.reason)).toEqual(['too_big', 'didnt_want'])
    expect(ctx.planner.tileMeta(first.data.dumpId!).skipCount).toBe(2)
  })

  it('focus block: end with minimum met saves the Bookmark and marks the item done', async () => {
    await ctx.dumps.add(['PSIR Plato'])
    const dump = ctx.dumps.getState().active[0]
    const added = await ctx.planner.addFromDump(dump)
    const itemId = added.ok ? added.id : ''
    const sessionId = (await ctx.planner.startFocus(itemId, 'starter'))!
    expect(ctx.planner.running()?.id).toBe(sessionId)
    // A second start returns the running session instead of starting another.
    expect(await ctx.planner.startFocus(itemId)).toBe(sessionId)

    await ctx.planner.pauseFocus(sessionId)
    await ctx.planner.resumeFocus(sessionId)
    await ctx.planner.endFocus(sessionId, { minMet: true, stoppedAt: 'p.14 heading 3' })

    const doc = ctx.store.getState().docs.get(sessionId)!
    expect((doc.data as FocusSession).endedAt).toBeTruthy()
    expect(ctx.planner.running()).toBeNull()
    const item = ctx.store.getState().docs.get(itemId)!.data as TodayItem
    expect(item).toMatchObject({ status: 'done', minMet: true, firstAction: 'Resume: p.14 heading 3' })
    expect(ctx.planner.tileMeta(dump.id).resumeNote).toBe('p.14 heading 3')

    // Next time the tile goes into Today, it starts from the Bookmark.
    await ctx.planner.reopen(itemId)
    await ctx.planner.skip(itemId, 'tired', 'dump')
    await ctx.planner.addFromDump(dump)
    expect(today(ctx).at(-1)!.data.firstAction).toBe('Resume: p.14 heading 3')
  })

  it('shutdown computes blocks done and the Floor', async () => {
    await ctx.dumps.add(['deep'])
    const added = await ctx.planner.addFromDump(ctx.dumps.getState().active[0])
    const id = added.ok ? added.id : ''
    await ctx.planner.updateItem(id, { type: 'block' })
    await ctx.planner.complete(id, true)
    await ctx.planner.shutdown(ctx.day, { tomorrowFirst: 'Pen in hand, p.15', foodSorted: true })
    expect(ctx.planner.dayPlan(ctx.day)).toMatchObject({ blocksDone: 1, floorMet: true, foodSorted: true, tomorrowFirst: 'Pen in hand, p.15' })
  })

  it('hour log sets, clears and only fills empty cells when asked', async () => {
    await ctx.planner.setHours(ctx.day, [4, 5], 'phone')
    await ctx.planner.setHours(ctx.day, [5, 6], 'study', { onlyEmpty: true })
    await ctx.planner.setHours(ctx.day, [4], null)
    expect(hourLogOf(ctx.store.getState().docs, ctx.day).hours).toEqual({ '5': 'phone', '6': 'study' })
  })

  it('seeds starter rules once and supports restart', async () => {
    await ctx.planner.seedRules()
    await ctx.planner.seedRules()
    expect(ctx.planner.rules()).toHaveLength(SEED_RULES.length)

    await ctx.dumps.add(['old thing'])
    const old = ctx.dumps.getState().active[0]
    const added = await ctx.planner.addFromDump(old, '2026-01-01')
    await ctx.planner.restart(ctx.day, [added.ok ? added.id : ''])
    const doc = ctx.store.getState().docs.get(added.ok ? added.id : '')!
    expect((doc.data as TodayItem).status).toBe('skipped')
    expect(ctx.planner.dayPlan(ctx.day).restartAt).toBeTruthy()
    expect([...ctx.store.getState().docs.values()].filter((d) => d.kind === KIND.dayPlan)).toHaveLength(1)
  })
})
