import { createClient, type AuthError, type PostgrestError, type User } from '@supabase/supabase-js'
import type { Dump, DumpStatus } from '@/domain/dump'
import type { PlannerDoc } from '@/domain/planner'
import type { AppUser } from '@/domain/user'
import { AppError, SetupRequiredError } from '../errors'
import type { AuthApi, Backend, DumpsApi, PlannerApi } from '../types'

interface DumpRow {
  id: string
  content: string
  position: number
  status: DumpStatus
  created_at: string
  updated_at: string
  completed_at: string | null
}

const COLUMNS = 'id,content,position,status,created_at,updated_at,completed_at'

const toDump = (r: DumpRow): Dump => ({
  id: r.id,
  content: r.content,
  position: Number(r.position),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  completedAt: r.completed_at,
})

interface PlannerRow {
  id: string
  kind: string
  day: string | null
  data: unknown
  created_at: string
  updated_at: string
}

const PLANNER_COLUMNS = 'id,kind,day,data,created_at,updated_at'

const toPlannerDoc = (r: PlannerRow): PlannerDoc => ({
  id: r.id,
  kind: r.kind,
  day: r.day,
  data: r.data,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

const toUser = (u: User): AppUser => ({
  id: u.id,
  email: u.email ?? '',
  displayName: (u.user_metadata?.display_name as string | undefined)?.trim() || u.email?.split('@')[0] || 'You',
})

/** Absolute URL inside this app (respects a sub-path deployment base). */
function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return new URL(`${base}${path}`, window.location.origin).toString()
}

function authError(error: AuthError): AppError {
  const msg = error.message.toLowerCase()
  if (error.code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return new AppError('Wrong email or password.', { cause: error })
  }
  if (error.code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return new AppError('Please confirm your email first — check your inbox for the link.', { cause: error })
  }
  if (error.code === 'user_already_exists' || msg.includes('already registered')) {
    return new AppError('An account with this email already exists. Try signing in.', { cause: error })
  }
  if (error.code === 'weak_password') {
    return new AppError(error.message || 'Please choose a stronger password.', { cause: error })
  }
  if (error.status === 429 || msg.includes('rate limit')) {
    return new AppError('Too many attempts. Please wait a minute and try again.', { cause: error })
  }
  return new AppError(error.message || 'Authentication failed.', { cause: error })
}

function dbError(error: PostgrestError): AppError {
  return new AppError(error.message || 'Could not reach the database.', { cause: error })
}

/** Like dbError, but a missing planner table means the planner migration hasn't been run. */
function plannerError(error: PostgrestError): AppError {
  const message = error.message ?? ''
  const missing =
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    (/planner_docs/.test(message) && /could not find|does not exist/i.test(message))
  return missing ? new SetupRequiredError({ cause: error }) : dbError(error)
}

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb = createClient(url, anonKey, {
    // Implicit flow: confirmation/reset links carry the session in the URL hash, so they work even
    // when opened in a different browser (e.g. a mail app's in-app browser). PKCE would require
    // the code verifier stored by the browser that requested the email.
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })

  const auth: AuthApi = {
    supportsPasswordReset: true,

    async currentUser() {
      const { data, error } = await sb.auth.getSession()
      if (error) throw authError(error)
      return data.session ? toUser(data.session.user) : null
    },

    onChange(listener) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        const user = session ? toUser(session.user) : null
        // Defer: calling Supabase from inside this callback can deadlock its auth lock.
        setTimeout(() => {
          if (event === 'PASSWORD_RECOVERY') listener(user, 'recovery')
          else if (event === 'SIGNED_OUT') listener(null, 'signed-out')
          else if (event === 'USER_UPDATED') listener(user, 'updated')
          else listener(user, user ? 'signed-in' : 'signed-out')
        }, 0)
      })
      return () => data.subscription.unsubscribe()
    },

    async signUp({ email, password, displayName }) {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() }, emailRedirectTo: appUrl('/') },
      })
      if (error) throw authError(error)
      // With email confirmation on, an existing address returns a user with no identities.
      if (data.user && data.user.identities?.length === 0) {
        throw new AppError('An account with this email already exists. Try signing in.')
      }
      return data.session ? 'signed-in' : 'confirm-email'
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
      if (error) throw authError(error)
    },

    async signOut() {
      // Only this device — signing out on a phone shouldn't log the laptop out.
      const { error } = await sb.auth.signOut({ scope: 'local' })
      if (error) throw authError(error)
    },

    async requestPasswordReset(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('/reset-password') })
      if (error) throw authError(error)
    },

    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password })
      if (error) throw authError(error)
    },
  }

  function dumps(userId: string): DumpsApi {
    const table = () => sb.from('dumps')

    return {
      async listActive() {
        const { data, error } = await table()
          .select(COLUMNS)
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
        if (error) throw dbError(error)
        return (data as DumpRow[]).map(toDump)
      },

      async listDone({ offset, limit }) {
        // Fetch one extra row to learn whether another page exists.
        const { data, error } = await table()
          .select(COLUMNS)
          .eq('user_id', userId)
          .eq('status', 'done')
          .order('completed_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(offset, offset + limit)
        if (error) throw dbError(error)
        const rows = (data as DumpRow[]).map(toDump)
        return { items: rows.slice(0, limit), hasMore: rows.length > limit }
      },

      async create(items) {
        const { data, error } = await table()
          .insert(items.map((i) => ({ id: i.id, user_id: userId, content: i.content, position: i.position })))
          .select(COLUMNS)
        if (error) throw dbError(error)
        return (data as DumpRow[]).map(toDump)
      },

      async updateContent(id, content) {
        const { error } = await table().update({ content }).eq('id', id).eq('user_id', userId)
        if (error) throw dbError(error)
      },

      async complete(id) {
        const { error } = await table()
          .update({ status: 'done', completed_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', userId)
        if (error) throw dbError(error)
      },

      async restore(id, position) {
        const { error } = await table()
          .update({ status: 'active', completed_at: null, position })
          .eq('id', id)
          .eq('user_id', userId)
        if (error) throw dbError(error)
      },

      async remove(id) {
        const { error } = await table().delete().eq('id', id).eq('user_id', userId)
        if (error) throw dbError(error)
      },

      async clearDone() {
        const { error } = await table().delete().eq('user_id', userId).eq('status', 'done')
        if (error) throw dbError(error)
      },

      async setPositions(updates) {
        if (updates.length === 0) return
        const { error } = await sb.rpc('set_dump_positions', {
          p_ids: updates.map((u) => u.id),
          p_positions: updates.map((u) => u.position),
        })
        if (error) throw dbError(error)
      },

      watch(onChange) {
        const onVisible = () => {
          if (document.visibilityState === 'visible') onChange()
        }
        window.addEventListener('focus', onVisible)
        document.addEventListener('visibilitychange', onVisible)
        // Live sync across devices (requires the table in the supabase_realtime publication).
        // DELETE events can't be filtered by column, so deletes from other devices are picked up
        // by the focus/visibility refresh instead.
        const filter = `user_id=eq.${userId}`
        const channel = sb
          .channel(`dumps:${userId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dumps', filter }, () => onChange())
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dumps', filter }, () => onChange())
          .subscribe()
        return () => {
          window.removeEventListener('focus', onVisible)
          document.removeEventListener('visibilitychange', onVisible)
          void sb.removeChannel(channel)
        }
      },
    }
  }

  function planner(userId: string): PlannerApi {
    const table = () => sb.from('planner_docs')

    return {
      async list({ kinds, sinceDay }) {
        if (kinds.length === 0) return []
        const { data, error } = await table()
          .select(PLANNER_COLUMNS)
          .eq('user_id', userId)
          .in('kind', [...kinds])
          .or(`day.is.null,day.gte.${sinceDay}`)
          .order('created_at', { ascending: true })
          .limit(10_000)
        if (error) throw plannerError(error)
        return (data as PlannerRow[]).map(toPlannerDoc)
      },

      async upsert(docs) {
        if (docs.length === 0) return
        const { error } = await table().upsert(
          docs.map((d) => ({ id: d.id, user_id: userId, kind: d.kind, day: d.day, data: d.data })),
          { onConflict: 'id' },
        )
        if (error) throw plannerError(error)
      },

      async insertMissing(docs) {
        if (docs.length === 0) return
        const { error } = await table().upsert(
          docs.map((d) => ({ id: d.id, user_id: userId, kind: d.kind, day: d.day, data: d.data })),
          { onConflict: 'id', ignoreDuplicates: true },
        )
        if (error) throw plannerError(error)
      },

      async remove(ids) {
        if (ids.length === 0) return
        const { error } = await table().delete().eq('user_id', userId).in('id', ids)
        if (error) throw plannerError(error)
      },

      watch(onChange) {
        const onVisible = () => {
          if (document.visibilityState === 'visible') onChange()
        }
        window.addEventListener('focus', onVisible)
        document.addEventListener('visibilitychange', onVisible)
        const filter = `user_id=eq.${userId}`
        const channel = sb
          .channel(`planner:${userId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'planner_docs', filter }, () => onChange())
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planner_docs', filter }, () => onChange())
          .subscribe()
        return () => {
          window.removeEventListener('focus', onVisible)
          document.removeEventListener('visibilitychange', onVisible)
          void sb.removeChannel(channel)
        }
      },
    }
  }

  return { kind: 'supabase', auth, dumps, planner }
}
