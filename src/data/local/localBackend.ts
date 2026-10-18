import type { Dump } from '@/domain/dump'
import type { PlannerDoc } from '@/domain/planner'
import type { AppUser } from '@/domain/user'
import { newId } from '@/lib/id'
import { AppError } from '../errors'
import type { AuthApi, AuthEvent, Backend, DumpsApi, PlannerApi } from '../types'
import { hashPassword, newSalt } from './password'
import { readJson, writeJson, type KeyValueStore } from './storage'

/**
 * Device-only backend: accounts and dumps live in this browser's storage.
 * Used when no cloud backend is configured, and for tests. Not a security boundary —
 * anyone with access to the browser profile can read the data.
 */

const USERS_KEY = 'minddump:local:users'
const SESSION_KEY = 'minddump:local:session'
const dumpsKey = (userId: string) => `minddump:local:dumps:${userId}`
const plannerKey = (userId: string) => `minddump:local:planner:${userId}`

interface StoredUser extends AppUser {
  salt: string
  hash: string
  createdAt: string
}

export interface LocalBackendOptions {
  /** PBKDF2 iterations; lowered in tests for speed. */
  iterations?: number
  /** Window to listen on for cross-tab `storage` events. */
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

const publicUser = ({ id, email, displayName }: StoredUser): AppUser => ({ id, email, displayName })

function assertCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new AppError('Device-only mode needs a secure page (https:// or localhost) to protect passwords.')
  }
}

export function createLocalBackend(store: KeyValueStore, options: LocalBackendOptions = {}): Backend {
  const iterations = options.iterations ?? 120_000
  const target = options.eventTarget ?? (typeof window === 'undefined' ? undefined : window)
  const listeners = new Set<(user: AppUser | null, event: AuthEvent) => void>()

  const users = () => readJson<StoredUser[]>(store, USERS_KEY, [])
  const findUser = (id: string | null) => (id ? users().find((u) => u.id === id) : undefined)
  const sessionUser = () => findUser(store.getItem(SESSION_KEY))

  const emit = (event: AuthEvent) => {
    const user = sessionUser()
    listeners.forEach((l) => l(user ? publicUser(user) : null, event))
  }

  const auth: AuthApi = {
    supportsPasswordReset: false,

    async currentUser() {
      const user = sessionUser()
      return user ? publicUser(user) : null
    },

    onChange(listener) {
      listeners.add(listener)
      const onStorage = (e: StorageEvent) => {
        if (e.key !== SESSION_KEY) return
        const user = sessionUser()
        listener(user ? publicUser(user) : null, user ? 'signed-in' : 'signed-out')
      }
      target?.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(listener)
        target?.removeEventListener('storage', onStorage)
      }
    },

    async signUp({ email, password, displayName }) {
      assertCrypto()
      const normalized = email.trim().toLowerCase()
      const all = users()
      if (all.some((u) => u.email === normalized)) {
        throw new AppError('An account with this email already exists on this device.')
      }
      const salt = newSalt()
      const user: StoredUser = {
        id: newId(),
        email: normalized,
        displayName: displayName.trim(),
        salt,
        hash: await hashPassword(password, salt, iterations),
        createdAt: new Date().toISOString(),
      }
      writeJson(store, USERS_KEY, [...all, user])
      store.setItem(SESSION_KEY, user.id)
      emit('signed-in')
      return 'signed-in'
    },

    async signIn(email, password) {
      assertCrypto()
      const user = users().find((u) => u.email === email.trim().toLowerCase())
      const hash = user ? await hashPassword(password, user.salt, iterations) : null
      if (!user || hash !== user.hash) throw new AppError('Wrong email or password.')
      store.setItem(SESSION_KEY, user.id)
      emit('signed-in')
    },

    async signOut() {
      store.removeItem(SESSION_KEY)
      emit('signed-out')
    },

    async requestPasswordReset() {
      throw new AppError('Password reset needs the cloud backend. In device-only mode, create a new account instead.')
    },

    async updatePassword(password) {
      const current = sessionUser()
      if (!current) throw new AppError('You need to be signed in to change your password.')
      const salt = newSalt()
      const hash = await hashPassword(password, salt, iterations)
      writeJson(store, USERS_KEY, users().map((u) => (u.id === current.id ? { ...u, salt, hash } : u)))
      emit('updated')
    },
  }

  function dumps(userId: string): DumpsApi {
    const key = dumpsKey(userId)
    const read = () => readJson<Dump[]>(store, key, [])
    const write = (items: Dump[]) => writeJson(store, key, items)
    const patch = (id: string, change: (d: Dump) => Dump) => {
      const now = new Date().toISOString()
      write(read().map((d) => (d.id === id ? { ...change(d), updatedAt: now } : d)))
    }

    return {
      async listActive() {
        return read()
          .filter((d) => d.status === 'active')
          .sort((a, b) => a.position - b.position)
      },

      async listDone({ offset, limit }) {
        const done = read()
          .filter((d) => d.status === 'done')
          .sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt))
        return { items: done.slice(offset, offset + limit), hasMore: done.length > offset + limit }
      },

      async create(items) {
        const now = new Date().toISOString()
        const created: Dump[] = items.map((i) => ({
          ...i,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        }))
        write([...read(), ...created])
        return created
      },

      async updateContent(id, content) {
        patch(id, (d) => ({ ...d, content }))
      },

      async complete(id) {
        patch(id, (d) => ({ ...d, status: 'done', completedAt: new Date().toISOString() }))
      },

      async restore(id, position) {
        patch(id, (d) => ({ ...d, status: 'active', completedAt: null, position }))
      },

      async remove(id) {
        write(read().filter((d) => d.id !== id))
      },

      async clearDone() {
        write(read().filter((d) => d.status !== 'done'))
      },

      async setPositions(updates) {
        const byId = new Map(updates.map((u) => [u.id, u.position]))
        write(read().map((d) => (byId.has(d.id) ? { ...d, position: byId.get(d.id)! } : d)))
      },

      watch(onChange) {
        const onStorage = (e: StorageEvent) => {
          if (e.key === key) onChange()
        }
        target?.addEventListener('storage', onStorage)
        return () => target?.removeEventListener('storage', onStorage)
      },
    }
  }

  function planner(userId: string): PlannerApi {
    const key = plannerKey(userId)
    const read = () => readJson<PlannerDoc[]>(store, key, [])
    const write = (docs: PlannerDoc[]) => writeJson(store, key, docs)

    return {
      async list({ kinds, sinceDay }) {
        const wanted = new Set(kinds)
        return read().filter((d) => wanted.has(d.kind) && (d.day === null || d.day >= sinceDay))
      },

      async upsert(docs) {
        const now = new Date().toISOString()
        const all = read()
        const index = new Map(all.map((d, i) => [d.id, i]))
        for (const doc of docs) {
          const at = index.get(doc.id)
          if (at === undefined) {
            index.set(doc.id, all.length)
            all.push({ ...doc, createdAt: now, updatedAt: now })
          } else {
            // Kind and creation time are fixed after insert (mirrors the database trigger).
            all[at] = { ...all[at], day: doc.day, data: doc.data, updatedAt: now }
          }
        }
        write(all)
      },

      async insertMissing(docs) {
        const now = new Date().toISOString()
        const all = read()
        const seen = new Set(all.map((d) => d.id))
        for (const doc of docs) {
          if (seen.has(doc.id)) continue
          seen.add(doc.id)
          all.push({ ...doc, createdAt: now, updatedAt: now })
        }
        write(all)
      },

      async remove(ids) {
        const gone = new Set(ids)
        write(read().filter((d) => !gone.has(d.id)))
      },

      watch(onChange) {
        const onStorage = (e: StorageEvent) => {
          if (e.key === key) onChange()
        }
        target?.addEventListener('storage', onStorage)
        return () => target?.removeEventListener('storage', onStorage)
      },
    }
  }

  return { kind: 'local', auth, dumps, planner }
}
