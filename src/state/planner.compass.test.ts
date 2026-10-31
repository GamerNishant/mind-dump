import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS } from '@/domain/plan'
import { itemsForDay } from '@/lib/plan'
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

const input = { title: 'Make history videos', why: 'I love explaining', output: '3 videos', minutes: 25, firstAction: 'Write the hook', cue: 'breakfast', runnerUp: 'Teach polity' }

describe('Planner compass', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('saves answers and candidates', async () => {
    await ctx.planner.saveAnswers({ flow: 'Editing', envy: '  ' })
    await ctx.planner.saveCandidates([{ id: 'c1', title: '  Videos  ', scores: { pull: 5 }, wins: 0, duels: 0 }])
    const c = ctx.planner.compass()
    expect(c.answers).toEqual({ flow: 'Editing' })
    expect(c.candidates[0].title).toBe('Videos')
  })

  it('lighting a fire makes a recurring high-priority block tile and puts it in Today with its first action', async () => {
    expect(await ctx.planner.lightFire(input)).toBe(true)
    const fire = ctx.planner.compass().fire!
    expect(fire).toMatchObject({ title: input.title, startDay: ctx.day, lengthDays: 14, sparks: [] })
    expect(ctx.dumps.getState().active.map((d) => d.content)).toEqual([input.title])
    const meta = ctx.planner.tileMeta(fire.dumpId!)
    expect(meta).toMatchObject({ repeat: [0, 1, 2, 3, 4, 5, 6], defaultType: 'block', defaultMinutes: 25, priority: 'high' })
    const item = itemsForDay(ctx.store.getState().docs, ctx.day).find((i) => i.data.dumpId === fire.dumpId)!
    expect(item.data).toMatchObject({ type: 'block', minutes: 25, firstAction: 'Write the hook', routine: true, status: 'open' })
  })

  it('logs one spark per day, extends, and ends (tile leaves the board, item leaves Today)', async () => {
    await ctx.planner.lightFire(input)
    await ctx.planner.logSpark({ day: ctx.day, minutes: 30, energy: 9, flow: true, note: '' })
    await ctx.planner.logSpark({ day: ctx.day, minutes: 20, energy: 4, flow: false, note: 'ok' })
    expect(ctx.planner.compass().fire!.sparks).toEqual([{ day: ctx.day, minutes: 20, energy: 4, flow: false, note: 'ok' }])

    await ctx.planner.extendFire('keep', 30)
    const extended = ctx.planner.compass()
    expect(extended.fire).toMatchObject({ lengthDays: 30, sparks: [] })
    expect(extended.past[0]).toMatchObject({ title: input.title, verdict: 'keep', sparks: 1 })

    const dumpId = extended.fire!.dumpId!
    await ctx.planner.endFire('switch')
    expect(ctx.planner.compass().fire).toBeNull()
    expect(ctx.planner.compass().past).toHaveLength(2)
    expect(ctx.dumps.getState().active).toEqual([])
    const item = itemsForDay(ctx.store.getState().docs, ctx.day).find((i) => i.data.dumpId === dumpId)!
    expect(item.data.status).toBe('skipped')
  })

  it('relighting replaces the running fire and archives it', async () => {
    await ctx.planner.lightFire(input)
    await ctx.planner.lightFire({ ...input, title: 'Teach polity', runnerUp: null }, 'switch')
    const c = ctx.planner.compass()
    expect(c.fire!.title).toBe('Teach polity')
    expect(c.past).toEqual([expect.objectContaining({ title: input.title, verdict: 'switch' })])
    expect(ctx.dumps.getState().active.map((d) => d.content)).toEqual(['Teach polity'])
  })

  it('persists across a reload', async () => {
    await ctx.planner.lightFire(input)
    const store = new PlannerStore(ctx.backend.planner(ctx.user.id), ALL_KINDS, () => '2000-01-01')
    await store.load()
    const again = new Planner(store, ctx.dumps, ctx.user.id)
    expect(again.compass().fire?.title).toBe(input.title)
  })
})
