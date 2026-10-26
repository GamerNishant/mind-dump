import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS, KIND, type FocusSession, type TodayItem } from '@/domain/plan'
import { hourLogOf, itemsForDay, planDay } from '@/lib/plan'
import { DumpsStore } from './dumpsStore'
import { Planner } from './planner'
import { PlannerStore } from './plannerStore'

/** Tile and Today item finish together, and Study hours for blocks that cross the hour. */

async function setup() {
  const backend = createLocalBackend(memoryStore(), { iterations: 10 })
  await backend.auth.signUp({ email: 'a@example.com', password: 'password1', displayName: 'A' })
  const user = (await backend.auth.currentUser())!
  const dumps = new DumpsStore(backend.dumps(user.id))
  await dumps.loadActive()
  const store = new PlannerStore(backend.planner(user.id), ALL_KINDS, () => '2000-01-01')
  await store.load()
  const planner = new Planner(store, dumps, user.id)
  return { dumps, store, planner, day: planner.today() }
}

type Ctx = Awaited<ReturnType<typeof setup>>

async function addToToday(ctx: Ctx, text: string): Promise<{ dumpId: string; itemId: string }> {
  await ctx.dumps.add([text])
  const dump = ctx.dumps.getState().active.find((d) => d.content === text)!
  const added = await ctx.planner.addFromDump(dump)
  return { dumpId: dump.id, itemId: added.ok ? added.id : '' }
}

const onBoard = (ctx: Ctx, dumpId: string) => ctx.dumps.getState().active.some((d) => d.id === dumpId)
const itemOf = (ctx: Ctx, id: string) => ctx.store.getState().docs.get(id)!.data as TodayItem

describe('Today and board finish together', () => {
  let ctx: Ctx
  beforeEach(async () => {
    ctx = await setup()
  })

  it('Done in Today clears the tile from the board; Undo puts it back', async () => {
    const { dumpId, itemId } = await addToToday(ctx, 'Pay electricity bill')
    await ctx.planner.complete(itemId)
    expect(onBoard(ctx, dumpId)).toBe(false)
    expect(ctx.planner.clearedTileOf(itemId)).toBe(true)

    await ctx.planner.reopen(itemId)
    expect(onBoard(ctx, dumpId)).toBe(true)
    expect(itemOf(ctx, itemId).status).toBe('open')
  })

  it('a block finished from Focus with its minimum met clears the tile too', async () => {
    const { dumpId, itemId } = await addToToday(ctx, 'PSIR Plato')
    const sessionId = (await ctx.planner.startFocus(itemId))!
    await ctx.planner.endFocus(sessionId, { minMet: true, stoppedAt: '' })
    expect(onBoard(ctx, dumpId)).toBe(false)
  })

  it('a block ended with a Bookmark keeps the tile (there is more to do)', async () => {
    const { dumpId, itemId } = await addToToday(ctx, 'PSIR Plato')
    const sessionId = (await ctx.planner.startFocus(itemId))!
    await ctx.planner.endFocus(sessionId, { minMet: true, stoppedAt: 'p.42' })
    expect(onBoard(ctx, dumpId)).toBe(true)
    expect(itemOf(ctx, itemId).status).toBe('done')
  })

  it('a block ended without its minimum keeps the tile', async () => {
    const { dumpId, itemId } = await addToToday(ctx, 'PSIR Plato')
    const sessionId = (await ctx.planner.startFocus(itemId))!
    await ctx.planner.endFocus(sessionId, { minMet: false, stoppedAt: 'p.3' })
    expect(onBoard(ctx, dumpId)).toBe(true)
  })

  it('recurring and habit tiles stay on the board', async () => {
    const recurring = await addToToday(ctx, 'Revise notes')
    await ctx.planner.setTileMeta(recurring.dumpId, { repeat: [0, 1, 2, 3, 4, 5, 6] })
    await ctx.planner.complete(recurring.itemId)
    expect(onBoard(ctx, recurring.dumpId)).toBe(true)

    const meal = await addToToday(ctx, 'Lunch')
    await ctx.planner.setTileMeta(meal.dumpId, { habit: true })
    await ctx.planner.complete(meal.itemId)
    expect(onBoard(ctx, meal.dumpId)).toBe(true)
  })

  it('clearing a tile on the board finishes its open Today item', async () => {
    const { dumpId, itemId } = await addToToday(ctx, 'Call mom')
    await ctx.dumps.complete(dumpId)
    expect(await ctx.planner.completeFromTile(dumpId)).toEqual([itemId])
    expect(itemOf(ctx, itemId)).toMatchObject({ status: 'done', minMet: true })
    // Nothing left to close a second time.
    expect(await ctx.planner.completeFromTile(dumpId)).toEqual([])
    expect(itemsForDay(ctx.store.getState().docs, ctx.day)).toHaveLength(1)
  })
})

describe('Study hours from focus blocks', () => {
  let ctx: Ctx
  beforeEach(async () => {
    ctx = await setup()
  })

  it('backfills both hours of an older block that crossed the hour, once', async () => {
    const { itemId } = await addToToday(ctx, 'Polity')
    const sessionId = (await ctx.planner.startFocus(itemId))!
    const start = new Date(Date.now() - 3 * 3_600_000)
    start.setMinutes(35, 0, 0)
    const end = new Date(start.getTime() + 50 * 60_000)
    // As an older version left it: ended, hours not logged.
    const doc = ctx.store.getState().docs.get(sessionId)!
    const data: FocusSession = { ...(doc.data as FocusSession), startedAt: start.toISOString(), endedAt: end.toISOString(), plannedMin: 50 }
    await ctx.store.put({ id: doc.id, kind: KIND.focus, day: doc.day, data })

    await ctx.planner.backfillStudyHours()
    const hourDay = (d: Date) => planDay(d, ctx.planner.settings().dayStartHour)
    expect(hourLogOf(ctx.store.getState().docs, hourDay(start)).hours[String(start.getHours())]).toBe('study')
    expect(hourLogOf(ctx.store.getState().docs, hourDay(end)).hours[String(end.getHours())]).toBe('study')

    // Cleared by hand: the backfill never refills it.
    await ctx.planner.setHours(hourDay(start), [start.getHours()], null)
    await ctx.planner.backfillStudyHours()
    expect(hourLogOf(ctx.store.getState().docs, hourDay(start)).hours[String(start.getHours())]).toBeUndefined()
  })

  it('ending a block marks the session logged', async () => {
    const { itemId } = await addToToday(ctx, 'Polity')
    const sessionId = (await ctx.planner.startFocus(itemId))!
    await ctx.planner.endFocus(sessionId, { minMet: false, stoppedAt: '' })
    expect((ctx.store.getState().docs.get(sessionId)!.data as FocusSession).hoursLogged).toBe(true)
  })
})
