import type { Dump } from '@/domain/dump'
import type { PlannerDoc } from '@/domain/planner'
import type { AppUser } from '@/domain/user'
import type { PositionUpdate } from '@/lib/position'

export type AuthEvent = 'signed-in' | 'signed-out' | 'recovery' | 'updated'

export interface SignUpInput {
  email: string
  password: string
  displayName: string
}

export type SignUpResult = 'signed-in' | 'confirm-email'

export interface AuthApi {
  /** Whether "forgot password" emails can be sent with this backend. */
  readonly supportsPasswordReset: boolean
  currentUser(): Promise<AppUser | null>
  onChange(listener: (user: AppUser | null, event: AuthEvent) => void): () => void
  signUp(input: SignUpInput): Promise<SignUpResult>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
}

export interface NewDump {
  id: string
  content: string
  position: number
}

export interface Page<T> {
  items: T[]
  hasMore: boolean
}

/** All dump operations are implicitly scoped to the signed-in user. */
export interface DumpsApi {
  listActive(): Promise<Dump[]>
  listDone(range: { offset: number; limit: number }): Promise<Page<Dump>>
  create(items: NewDump[]): Promise<Dump[]>
  updateContent(id: string, content: string): Promise<void>
  complete(id: string): Promise<void>
  restore(id: string, position: number): Promise<void>
  remove(id: string): Promise<void>
  clearDone(): Promise<void>
  setPositions(updates: PositionUpdate[]): Promise<void>
  /** Notifies when data may have changed elsewhere (other tab/device). Returns unsubscribe. */
  watch(onChange: () => void): () => void
}

/** A planner document as written by the client (timestamps are owned by the backend). */
export type PlannerDocInput = Pick<PlannerDoc, 'id' | 'kind' | 'day' | 'data'>

/** Generic per-user document storage for the planner (see src/domain/planner.ts). */
export interface PlannerApi {
  /** Documents of the given kinds that are undated or dated on/after `sinceDay` (YYYY-MM-DD). */
  list(query: { kinds: readonly string[]; sinceDay: string }): Promise<PlannerDoc[]>
  /** Insert or replace whole documents. */
  upsert(docs: PlannerDocInput[]): Promise<void>
  /** Insert documents whose id doesn't exist yet; existing ones are left untouched. */
  insertMissing(docs: PlannerDocInput[]): Promise<void>
  remove(ids: string[]): Promise<void>
  /** Notifies when data may have changed elsewhere (other tab/device). Returns unsubscribe. */
  watch(onChange: () => void): () => void
}

export interface Backend {
  readonly kind: 'supabase' | 'local'
  readonly auth: AuthApi
  dumps(userId: string): DumpsApi
  planner(userId: string): PlannerApi
}
