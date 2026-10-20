import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS, KIND } from '@/domain/plan'
import { buildExport } from '@/data/exportData'
import { addDays, hourLogOf } from '@/lib/plan'
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
  const planner = new Planner(store, dumps, user.id)
  return { backend, user, dumps, store, planner, day: planner.today() }
}

describe('Planner habits, Other tags and priority', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('adds habits in stack order, logs with one tap, and undoes with another', async () => {
    const a = (await ctx.planner.addHabit('  Drink   water '))!
    const b = (await ctx.planner.addHabit('Read', [1, 3, 5]))!
    expect(await ctx.planner.addHabit('   ')).toBeNull()
    expect(ctx.planner.habits().map((h) => [h.data.name, h.data.days.length])).toEqual([
      ['Drink water', 7],
      ['Read', 3],
    ])
    expect(await ctx.planner.toggleHabit(a)).toBe(true)
    expect(ctx.planner.habits()[0].data.done).toEqual([ctx.day])
    expect(await ctx.planner.toggleHabit(a)).toBe(false)
    expect(ctx.planner.habits()[0].data.done).toEqual([])

    await ctx.planner.moveHabit(b, -1)
    expect(ctx.planner.habits().map((h) => h.id)).toEqual([b, a])
  })

  it('backfilling a day before the start moves the start back', async () => {
    const id = (await ctx.planner.addHabit('Walk'))!
    const twoDaysAgo = addDays(ctx.day, -2)
    await ctx.planner.toggleHabit(id, twoDaysAgo)
    expect(ctx.planner.habits()[0].data).toMatchObject({ done: [twoDaysAgo], startDay: twoDaysAgo })
  })

  it('edits, deletes and restores a habit (persisted)', async () => {
    const id = (await ctx.planner.addHabit('Stretch'))!
    await ctx.planner.toggleHabit(id)
    expect(await ctx.planner.updateHabit(id, { name: 'Stretch 5 min', days: [0, 6] })).toBe(true)
    expect(await ctx.planner.updateHabit(id, { name: ' ' })).toBe(false)
    const snapshot = ctx.planner.habits()[0]
    await ctx.planner.removeHabit(id)
    expect(ctx.planner.habits()).toEqual([])
    await ctx.planner.restoreHabit(snapshot)
    await ctx.store.load()
    expect(ctx.planner.habits()[0].data).toMatchObject({ name: 'Stretch 5 min', days: [0, 6], done: [ctx.day] })
  })

  it('remembers named Other tags and logs hours with them', async () => {
    await ctx.planner.addOtherTag('Gym')
    await ctx.planner.addOtherTag('gym ')
    await ctx.planner.addOtherTag('Travel')
    expect(ctx.planner.settings().otherTags).toEqual(['Gym', 'Travel'])
    await ctx.planner.setHours(ctx.day, [6, 7], 'other:Gym')
    expect(hourLogOf(ctx.store.getState().docs, ctx.day).hours).toEqual({ '6': 'other:Gym', '7': 'other:Gym' })
    await ctx.planner.removeOtherTag('GYM')
    expect(ctx.planner.settings().otherTags).toEqual(['Travel'])
  })

  it('stores priority on the tile meta', async () => {
    await ctx.dumps.add(['Pay rent'])
    const dump = ctx.dumps.getState().active[0]
    expect(ctx.planner.tileMeta(dump.id).priority).toBeNull()
    await ctx.planner.setTileMeta(dump.id, { priority: 'high' })
    expect(ctx.planner.tileMeta(dump.id).priority).toBe('high')
  })

  it('exports everything as one backup', async () => {
    await ctx.dumps.add(['one', 'two'])
    await ctx.dumps.complete(ctx.dumps.getState().active[0].id)
    await ctx.planner.addHabit('Read')
    const data = await buildExport(ctx.backend, ctx.user)
    expect(data.dumps.active).toHaveLength(1)
    expect(data.dumps.done).toHaveLength(1)
    expect(data.planner.some((d) => d.kind === KIND.habit)).toBe(true)
    expect(data.plannerAvailable).toBe(true)
  })
})
