/**
 * Planner documents: small JSON records stored per user in one generic table
 * (`public.planner_docs`). `kind` says what the record is; `day` (local YYYY-MM-DD) ties it to
 * a calendar day when it belongs to one. The typed shapes for each kind live in
 * src/domain/plan.ts.
 */
export interface PlannerDoc<T = unknown> {
  id: string
  kind: string
  /** Local calendar day (YYYY-MM-DD) the document belongs to, or null for undated documents. */
  day: string | null
  data: T
  createdAt: string
  updatedAt: string
}
