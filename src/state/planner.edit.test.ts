import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import { ALL_KINDS } from '@/domain/plan'
import { greetingFor, momentumLine } from '@/lib/greeting'
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
  return { dumps, store, planner, day: planner.today() }
}

describe('Editing and removing queue items', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  const items = () => itemsForDay(ctx.store.getState().docs, ctx.day)
  beforeEach(async () => {
    ctx = await setup()
  })

  it('"No longer relevant" closes the item but keeps the tile; reopen undoes it', async () => {
    const added = await ctx.planner.addText('Book the train', 'task')
    expect(added.ok).toBe(true)
    const [item] = items()
    expect(await ctx.planner.dismiss(item.id)).toEqual({ tileCleared: false })
    expect(items()[0].data).toMatchObject({ status: 'skipped' })
    expect(items()[0].data.skips.at(-1)).toMatchObject({ reason: 'not_relevant', to: 'dump' })
    expect(ctx.dumps.getState().active.map((d) => d.content)).toEqual(['Book the train'])
    await ctx.planner.reopen(item.id)
    expect(items()[0].data.status).toBe('open')
  })

  it('can also clear the tile, and frees the slot for the cap', async () => {
    await ctx.planner.addText('Old errand', 'task')
    const [item] = items()
    expect(await ctx.planner.dismiss(item.id, { clearTile: true })).toEqual({ tileCleared: true })
    expect(ctx.dumps.getState().active).toEqual([])
    expect(await ctx.planner.dismiss('missing')).toBeNull()
  })

  it('renaming an item renames the first line of its tile', async () => {
    await ctx.dumps.add(['Read chapter 3\nnotes: focus on Locke'])
    const dump = ctx.dumps.getState().active[0]
    await ctx.planner.addFromDump(dump)
    const [item] = items()
    expect(await ctx.planner.retitle(item.id, '  Read chapter 4  ')).toBe(true)
    expect(items()[0].data.title).toBe('Read chapter 4')
    expect(ctx.dumps.getState().active[0].content).toBe('Read chapter 4\nnotes: focus on Locke')
    expect(await ctx.planner.retitle(item.id, '   ')).toBe(false)
  })
})

describe('greeting', () => {
  it('greets by time of day', () => {
    expect(greetingFor(2, 3)).toBe('Still up')
    expect(greetingFor(5, 3)).toBe('Good morning')
    expect(greetingFor(13, 3)).toBe('Good afternoon')
    expect(greetingFor(20, 3)).toBe('Good evening')
  })
  it('keeps the progress line kind', () => {
    expect(momentumLine(0, 3)).toMatch(/smallest thing/)
    expect(momentumLine(0, 0)).toMatch(/fresh page/)
    expect(momentumLine(1, 2)).toBe('1 done already. Nice start.')
    expect(momentumLine(4, 1)).toBe('4 done today. Keep the streak rolling.')
    expect(momentumLine(4, 0)).toMatch(/nothing left/)
  })
})
