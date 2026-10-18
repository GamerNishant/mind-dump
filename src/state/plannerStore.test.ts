import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupRequiredError } from '@/data/errors'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import type { PlannerApi } from '@/data/types'
import { PlannerStore } from './plannerStore'

async function setup() {
  const backend = createLocalBackend(memoryStore(), { iterations: 10 })
  await backend.auth.signUp({ email: 'a@example.com', password: 'password1', displayName: 'A' })
  const user = (await backend.auth.currentUser())!
  const api = backend.planner(user.id)
  const errors: string[] = []
  const store = new PlannerStore(api, ['task', 'rule'], () => '2026-10-01', (m) => errors.push(m))
  await store.load()
  return { api, store, errors }
}

const ids = (store: PlannerStore) => [...store.getState().docs.keys()].sort()

describe('PlannerStore', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('starts ready and empty', () => {
    expect(ctx.store.getState().status).toBe('ready')
    expect(ctx.store.getState().docs.size).toBe(0)
  })

  it('puts, replaces and removes documents, persisting each change', async () => {
    await ctx.store.put({ id: 'a', kind: 'task', day: '2026-10-18', data: { title: 'Read' } })
    await ctx.store.put({ id: 'b', kind: 'rule', day: null, data: { if: 'x', then: 'y' } })
    expect(ids(ctx.store)).toEqual(['a', 'b'])

    const created = ctx.store.getState().docs.get('a')!.createdAt
    await ctx.store.put({ id: 'a', kind: 'task', day: '2026-10-18', data: { title: 'Read more' } })
    expect(ctx.store.getState().docs.get('a')!.data).toEqual({ title: 'Read more' })
    expect(ctx.store.getState().docs.get('a')!.createdAt).toBe(created)

    await ctx.store.remove('b')
    expect(ids(ctx.store)).toEqual(['a'])
    const persisted = await ctx.api.list({ kinds: ['task', 'rule'], sinceDay: '2026-10-01' })
    expect(persisted.map((d) => [d.id, d.data])).toEqual([['a', { title: 'Read more' }]])
  })

  it('only loads wanted kinds and recent days; undated docs always load', async () => {
    await ctx.api.upsert([
      { id: 'old', kind: 'task', day: '2026-09-01', data: {} },
      { id: 'new', kind: 'task', day: '2026-10-02', data: {} },
      { id: 'undated', kind: 'rule', day: null, data: {} },
      { id: 'other', kind: 'note', day: '2026-10-02', data: {} },
    ])
    await ctx.store.load()
    expect(ids(ctx.store)).toEqual(['new', 'undated'])
  })

  it('rolls back and reports when the backend rejects a write', async () => {
    const failing: PlannerApi = { ...ctx.api, upsert: vi.fn().mockRejectedValue(new Error('boom')) }
    const store = new PlannerStore(failing, ['task'], () => '2026-10-01', (m) => ctx.errors.push(m))
    await store.load()
    expect(await store.put({ id: 'x', kind: 'task', day: null, data: {} }, "Couldn't save the task")).toBe(false)
    expect(store.getState().docs.has('x')).toBe(false)
    expect(ctx.errors).toEqual(["Couldn't save the task. boom"])
  })

  it('switches to setup status when the planner table is missing', async () => {
    const missing: PlannerApi = { ...ctx.api, list: vi.fn().mockRejectedValue(new SetupRequiredError()) }
    const store = new PlannerStore(missing, ['task'], () => '2026-10-01', (m) => ctx.errors.push(m))
    await store.load()
    expect(store.getState().status).toBe('setup')
    expect(ctx.errors).toEqual([])
  })

  it('keeps writes to the same document in order', async () => {
    const order: string[] = []
    const slow: PlannerApi = {
      ...ctx.api,
      upsert: async (docs) => {
        const title = (docs[0].data as { title: string }).title
        if (title === 'first') await new Promise((r) => setTimeout(r, 20))
        order.push(title)
        await ctx.api.upsert(docs)
      },
    }
    const store = new PlannerStore(slow, ['task'], () => '2026-10-01')
    await store.load()
    await Promise.all([
      store.put({ id: 'a', kind: 'task', day: null, data: { title: 'first' } }),
      store.put({ id: 'a', kind: 'task', day: null, data: { title: 'second' } }),
    ])
    expect(order).toEqual(['first', 'second'])
    const [saved] = await ctx.api.list({ kinds: ['task'], sinceDay: '2026-10-01' })
    expect(saved.data).toEqual({ title: 'second' })
  })
})
