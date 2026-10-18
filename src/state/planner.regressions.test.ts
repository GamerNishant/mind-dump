import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS, KIND, SEED_RULES, type TodayItem } from '@/domain/plan'
import { addDays, dayPlanId, itemsForDay, planRollover, settingsId } from '@/lib/plan'
import { DumpsStore } from './dumpsStore'
import { Planner } from './planner'
import { PlannerStore } from './plannerStore'

/** Regression tests for issues found in review (duplicates, caps, focus, ids, seeding). */
async function setup(store = memoryStore(), email = 'a@example.com') {
  const backend = createLocalBackend(store, { iterations: 10 })
  await backend.auth.signUp({ email, password: 'password1', displayName: 'A' })
  const user = (await backend.auth.currentUser())!
  const dumps = new DumpsStore(backend.dumps(user.id))
  await dumps.loadActive()
  const plannerStore = new PlannerStore(backend.planner(user.id), ALL_KINDS, () => '2000-01-01')
  await plannerStore.load()
  const planner = new Planner(plannerStore, dumps, user.id)
  return { user, dumps, store: plannerStore, planner, day: planner.today() }
}

type Ctx = Awaited<ReturnType<typeof setup>>
const items = (ctx: Ctx, day = ctx.day) => itemsForDay(ctx.store.getState().docs, day)
const live = (ctx: Ctx, day = ctx.day) => items(ctx, day).filter((i) => i.data.status !== 'skipped')

async function addTile(ctx: Ctx, text: string) {
  await ctx.dumps.add([text])
  return ctx.dumps.getState().active.find((d) => d.content === text)!
}

const rollover = (ctx: Ctx, day = ctx.day) =>
  planRollover({ docs: ctx.store.getState().docs, today: day, activeDumps: ctx.dumps.getState().active })

describe('planner regressions', () => {
  let ctx: Ctx
  beforeEach(async () => {
    ctx = await setup()
  })

  it('setting Repeat on a tile already in Today does not create a second item', async () => {
    const gym = await addTile(ctx, 'Gym')
    await ctx.planner.addFromDump(gym)
    await ctx.planner.setTileMeta(gym.id, { repeat: [0, 1, 2, 3, 4, 5, 6] })
    expect(rollover(ctx).creates).toEqual([])
  })

  it('a routine skipped to tomorrow is not duplicated by tomorrow’s routine', async () => {
    const lunch = await addTile(ctx, 'Lunch')
    await ctx.planner.setTileMeta(lunch.id, { repeat: [0, 1, 2, 3, 4, 5, 6], habit: true })
    await ctx.store.create(rollover(ctx).creates)
    const [routine] = items(ctx)
    await ctx.planner.skip(routine.id, 'tired', 'tomorrow')
    const tomorrow = addDays(ctx.day, 1)
    expect(rollover(ctx, tomorrow).creates).toEqual([])
  })

  it('skipping to tomorrow when the tile is already planned there closes this copy instead', async () => {
    const x = await addTile(ctx, 'X')
    const tomorrow = addDays(ctx.day, 1)
    await ctx.planner.addFromDump(x, tomorrow)
    const added = await ctx.planner.addFromDump(x)
    await ctx.planner.skip(added.ok ? added.id : '', 'tired', 'tomorrow')
    expect(live(ctx, tomorrow)).toHaveLength(1)
    expect(live(ctx)).toHaveLength(0)
  })

  it('carry-over does not duplicate a tile that is already in today', async () => {
    const x = await addTile(ctx, 'X')
    const yesterday = addDays(ctx.day, -1)
    await ctx.planner.addFromDump(x, yesterday)
    await ctx.planner.addFromDump(x)
    const plan = rollover(ctx)
    const old = plan.updates.find((u) => u.kind === KIND.todayItem)!
    expect(old.day).toBe(yesterday)
    expect((old.data as TodayItem).status).toBe('skipped')
  })

  it('bringBack respects the caps and leaves the rest', async () => {
    for (const [i, t] of ['a', 'b', 'c'].entries()) {
      const tile = await addTile(ctx, t)
      await ctx.planner.setTileMeta(tile.id, { defaultType: 'block' })
      // Spread over two old days (each day has its own cap).
      await ctx.planner.addFromDump(tile, addDays(ctx.day, i < 2 ? -5 : -4))
    }
    const stale = rollover(ctx).stale.map((s) => s.id)
    expect(stale).toHaveLength(3)
    expect(await ctx.planner.bringBack(ctx.day, stale)).toEqual({ brought: 2, left: 1 })
    expect(live(ctx).filter((i) => i.data.type === 'block')).toHaveLength(2)
  })

  it('switching a block to a task respects the task cap', async () => {
    await ctx.planner.updateSettings({ taskCap: 1 })
    const t = await addTile(ctx, 'task')
    const b = await addTile(ctx, 'block')
    await ctx.planner.setTileMeta(b.id, { defaultType: 'block' })
    await ctx.planner.addFromDump(t)
    const added = await ctx.planner.addFromDump(b)
    expect(await ctx.planner.updateItem(added.ok ? added.id : '', { type: 'task' })).toBe(false)
  })

  it('Done or Skip on an item ends its running focus block', async () => {
    const tile = await addTile(ctx, 'Deep work')
    const added = await ctx.planner.addFromDump(tile)
    const id = added.ok ? added.id : ''
    await ctx.planner.startFocus(id)
    await ctx.planner.complete(id, true)
    expect(ctx.planner.running()).toBeNull()

    await ctx.planner.reopen(id)
    await ctx.planner.startFocus(id)
    await ctx.planner.skip(id, 'tired', 'dump')
    expect(ctx.planner.running()).toBeNull()
  })

  it('a block left running long after its time logs at most its planned length', async () => {
    const tile = await addTile(ctx, 'Short')
    const added = await ctx.planner.addFromDump(tile)
    const sessionId = (await ctx.planner.startFocus(added.ok ? added.id : ''))!
    const doc = ctx.store.getState().docs.get(sessionId)!
    // Pretend it started 5 hours ago (25-minute task block).
    const startedAt = new Date(Date.now() - 5 * 3_600_000).toISOString()
    await ctx.store.put({ ...doc, data: { ...(doc.data as object), startedAt } })
    await ctx.planner.endFocus(sessionId, { minMet: true, stoppedAt: '' })
    const ended = ctx.store.getState().docs.get(sessionId)!.data as { endedAt: string }
    expect(Date.parse(ended.endedAt) - Date.parse(startedAt)).toBe(25 * 60_000)
  })

  it('morning check keeps the "stopped at" note even without a Yes/Partly/No', async () => {
    const tile = await addTile(ctx, 'PSIR')
    await ctx.planner.setTileMeta(tile.id, { defaultType: 'block' })
    await ctx.planner.addFromDump(tile)
    await ctx.planner.morningCheck(ctx.day, null, 'p.42')
    expect(ctx.planner.tileMeta(tile.id).resumeNote).toBe('p.42')
    expect(items(ctx)[0].data.firstAction).toBe('Resume: p.42')
  })

  it('retiring a deleted tile closes its open items', async () => {
    const tile = await addTile(ctx, 'gone')
    await ctx.planner.addFromDump(tile)
    await ctx.planner.retireDump(tile.id)
    expect(items(ctx)[0].data).toMatchObject({ status: 'skipped' })
    expect(items(ctx)[0].data.skips.at(-1)?.reason).toBe('deleted')
  })

  it('prepareRoutines creates tomorrow’s routine items early, once', async () => {
    const psir = await addTile(ctx, 'PSIR')
    await ctx.planner.setTileMeta(psir.id, { repeat: [0, 1, 2, 3, 4, 5, 6], defaultType: 'block' })
    const tomorrow = addDays(ctx.day, 1)
    await ctx.planner.prepareRoutines(tomorrow)
    await ctx.planner.prepareRoutines(tomorrow)
    expect(live(ctx, tomorrow).map((i) => i.data.title)).toEqual(['PSIR'])
    expect(rollover(ctx, tomorrow).creates).toEqual([])
  })

  it('per-user singleton ids differ between accounts', () => {
    expect(dayPlanId('user-a', ctx.day)).not.toBe(dayPlanId('user-b', ctx.day))
    expect(settingsId('user-a')).not.toBe(settingsId('user-b'))
  })

  it('seeding rules twice (two devices) yields one set', async () => {
    const shared = memoryStore()
    const a = await setup(shared, 'b@example.com')
    // A second device for the same account with its own (stale) store.
    const second = new PlannerStore(createLocalBackend(shared, { iterations: 10 }).planner(a.user.id), ALL_KINDS, () => '2000-01-01')
    await second.load()
    const planner2 = new Planner(second, a.dumps, a.user.id)
    await Promise.all([a.planner.seedRules(), planner2.seedRules()])
    await a.store.load()
    expect(a.planner.rules()).toHaveLength(SEED_RULES.length)
  })
})
