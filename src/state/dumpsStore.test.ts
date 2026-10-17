import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalBackend } from '@/data/local/localBackend'
import { memoryStore } from '@/data/local/storage'
import type { DumpsApi } from '@/data/types'
import { DumpsStore } from './dumpsStore'

async function setup() {
  const backend = createLocalBackend(memoryStore(), { iterations: 10 })
  await backend.auth.signUp({ email: 'a@example.com', password: 'password1', displayName: 'A' })
  const user = (await backend.auth.currentUser())!
  const api = backend.dumps(user.id)
  const errors: string[] = []
  const store = new DumpsStore(api, (m) => errors.push(m))
  await store.loadActive()
  return { backend, api, store, errors }
}

const contents = (store: DumpsStore) => store.getState().active.map((d) => d.content)

describe('DumpsStore', () => {
  let ctx: Awaited<ReturnType<typeof setup>>
  beforeEach(async () => {
    ctx = await setup()
  })

  it('adds new dumps on top, preserving the order given', async () => {
    await ctx.store.add(['first'])
    await ctx.store.add(['a', 'b', 'c'])
    expect(contents(ctx.store)).toEqual(['a', 'b', 'c', 'first'])
    expect((await ctx.api.listActive()).map((d) => d.content)).toEqual(['a', 'b', 'c', 'first'])
  })

  it('ignores blank input and trims', async () => {
    expect(await ctx.store.add(['   ', ''])).toBe(false)
    await ctx.store.add(['  hello  '])
    expect(contents(ctx.store)).toEqual(['hello'])
  })

  it('complete moves to history; restore(original) puts it back in place', async () => {
    await ctx.store.add(['a', 'b', 'c'])
    await ctx.store.loadDone()
    const b = ctx.store.getState().active[1]
    const original = await ctx.store.complete(b.id)
    expect(contents(ctx.store)).toEqual(['a', 'c'])
    expect(ctx.store.getState().done.map((d) => d.content)).toEqual(['b'])
    expect(ctx.store.getState().done[0].completedAt).toBeTruthy()

    await ctx.store.restore(original!, 'original')
    expect(contents(ctx.store)).toEqual(['a', 'b', 'c'])
    expect(ctx.store.getState().done).toEqual([])
    const persisted = await ctx.api.listActive()
    expect(persisted.map((d) => d.content)).toEqual(['a', 'b', 'c'])
    expect(persisted[1].completedAt).toBeNull()
  })

  it('restore(top) from history puts it first', async () => {
    await ctx.store.add(['a', 'b', 'c'])
    const c = ctx.store.getState().active[2]
    await ctx.store.complete(c.id)
    await ctx.store.loadDone()
    await ctx.store.restore(ctx.store.getState().done[0], 'top')
    expect(contents(ctx.store)).toEqual(['c', 'a', 'b'])
  })

  it('moveTo reorders to exactly the order shown and persists', async () => {
    await ctx.store.add(['a', 'b', 'c', 'd'])
    const [a, b, c, d] = ctx.store.getState().active.map((x) => x.id)
    await ctx.store.moveTo(a, [b, c, d, a])
    expect(contents(ctx.store)).toEqual(['b', 'c', 'd', 'a'])
    await ctx.store.moveTo(a, [b, a, c, d])
    expect(contents(ctx.store)).toEqual(['b', 'a', 'c', 'd'])
    expect((await ctx.api.listActive()).map((x) => x.content)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('tied positions still reorder to what the user saw', async () => {
    await ctx.api.create([
      { id: 'x1', content: 'one', position: 0 },
      { id: 'x2', content: 'two', position: 0 },
      { id: 'x3', content: 'three', position: 1024 },
    ])
    await ctx.store.loadActive()
    const shown = ctx.store.getState().active.map((x) => x.id)
    const moved = [shown[1], shown[0], shown[2]]
    await ctx.store.moveTo(shown[0], moved)
    expect(ctx.store.getState().active.map((x) => x.id)).toEqual(moved)
    const persisted = (await ctx.api.listActive()).map((x) => x.id)
    expect(persisted).toEqual(moved)
  })

  it('adding before the board has loaded still lands on top', async () => {
    await ctx.store.add(['old', 'newer'])
    const fresh = new DumpsStore(ctx.api)
    await fresh.add(['newest']) // no loadActive() first
    expect((await ctx.api.listActive()).map((x) => x.content)).toEqual(['newest', 'old', 'newer'])
  })

  it('history load discarded by an in-flight write is retried (no endless skeleton)', async () => {
    await ctx.store.add(['a', 'b'])
    let release!: () => void
    const slow: DumpsApi = {
      ...ctx.api,
      complete: async (id) => {
        await new Promise<void>((r) => (release = r))
        await ctx.api.complete(id)
      },
    }
    const store = new DumpsStore(slow)
    await store.loadActive()
    const completing = store.complete(store.getState().active[0].id)
    store.setHistoryOpen(true) // load starts while the write is in flight → discarded
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release()
    await completing
    await vi.waitFor(() => expect(store.getState().doneStatus).toBe('ready'), { timeout: 2000 })
    expect(store.getState().done.map((x) => x.content)).toEqual(['a'])
  })

  it('setOrder adopts an explicit order', async () => {
    await ctx.store.add(['a', 'b', 'c'])
    const ids = ctx.store.getState().active.map((d) => d.id)
    await ctx.store.setOrder([ids[2], ids[0], ids[1]])
    expect(contents(ctx.store)).toEqual(['c', 'a', 'b'])
    expect((await ctx.api.listActive()).map((d) => d.content)).toEqual(['c', 'a', 'b'])
  })

  it('edit and remove', async () => {
    await ctx.store.add(['a', 'b'])
    const [a, b] = ctx.store.getState().active
    await ctx.store.edit(a.id, '  A!  ')
    await ctx.store.remove(b.id)
    expect(contents(ctx.store)).toEqual(['A!'])
    expect((await ctx.api.listActive()).map((d) => d.content)).toEqual(['A!'])
  })

  it('clearDone empties history but keeps the board', async () => {
    await ctx.store.add(['a', 'b'])
    await ctx.store.complete(ctx.store.getState().active[0].id)
    await ctx.store.loadDone()
    await ctx.store.clearDone()
    expect(ctx.store.getState().done).toEqual([])
    expect((await ctx.api.listDone({ offset: 0, limit: 10 })).items).toEqual([])
    expect(contents(ctx.store)).toEqual(['b'])
  })

  it('rolls back and reports when the backend fails', async () => {
    await ctx.store.add(['a'])
    const failing: DumpsApi = { ...ctx.api, complete: () => Promise.reject(new Error('boom')) }
    const errors: string[] = []
    const store = new DumpsStore(failing, (m) => errors.push(m))
    await store.loadActive()
    const id = store.getState().active[0].id
    expect(await store.complete(id)).toBeNull()
    expect(store.getState().active.map((d) => d.id)).toEqual([id])
    expect(errors[0]).toMatch(/boom/)
  })

  it('serialises requests per dump (undo during a slow complete)', async () => {
    await ctx.store.add(['a'])
    const calls: string[] = []
    let releaseComplete!: () => void
    const slow: DumpsApi = {
      ...ctx.api,
      complete: async (id) => {
        calls.push('complete:start')
        await new Promise<void>((r) => (releaseComplete = r))
        await ctx.api.complete(id)
        calls.push('complete:end')
      },
      restore: async (id, pos) => {
        calls.push('restore')
        await ctx.api.restore(id, pos)
      },
    }
    const store = new DumpsStore(slow)
    await store.loadActive()
    const dump = store.getState().active[0]
    const completing = store.complete(dump.id)
    const restoring = store.restore(dump, 'original')
    await vi.waitFor(() => expect(calls).toContain('complete:start'))
    releaseComplete()
    await Promise.all([completing, restoring])
    expect(calls).toEqual(['complete:start', 'complete:end', 'restore'])
    expect((await ctx.api.listActive()).map((d) => d.id)).toEqual([dump.id])
  })

  it('history paginates', async () => {
    await ctx.store.add(Array.from({ length: 60 }, (_, i) => `item ${i}`))
    for (const d of [...ctx.store.getState().active]) await ctx.store.complete(d.id)
    await ctx.store.loadDone()
    expect(ctx.store.getState().done).toHaveLength(50)
    expect(ctx.store.getState().doneHasMore).toBe(true)
    await ctx.store.loadMoreDone()
    expect(ctx.store.getState().done).toHaveLength(60)
    expect(ctx.store.getState().doneHasMore).toBe(false)
  })
})

describe('local backend auth', () => {
  it('isolates data per user and checks passwords', async () => {
    const backend = createLocalBackend(memoryStore(), { iterations: 10 })
    await backend.auth.signUp({ email: 'One@Example.com', password: 'password1', displayName: 'One' })
    const one = (await backend.auth.currentUser())!
    await backend.dumps(one.id).create([{ id: 'x', content: 'secret', position: 0 }])
    await backend.auth.signOut()
    expect(await backend.auth.currentUser()).toBeNull()

    await backend.auth.signUp({ email: 'two@example.com', password: 'password2', displayName: 'Two' })
    const two = (await backend.auth.currentUser())!
    expect(await backend.dumps(two.id).listActive()).toEqual([])

    await expect(backend.auth.signIn('one@example.com', 'wrong-pass')).rejects.toThrow(/wrong email or password/i)
    await expect(
      backend.auth.signUp({ email: 'one@example.com', password: 'password1', displayName: 'Dup' }),
    ).rejects.toThrow(/already exists/i)
    await backend.auth.signIn(' ONE@example.com ', 'password1')
    expect((await backend.auth.currentUser())!.id).toBe(one.id)
    expect((await backend.dumps(one.id).listActive()).map((d) => d.content)).toEqual(['secret'])
  })
})
