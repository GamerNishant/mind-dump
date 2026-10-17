export type DumpStatus = 'active' | 'done'

export interface Dump {
  id: string
  content: string
  /** Manual ordering key (ascending). Fractional so a move only rewrites one row. */
  position: number
  status: DumpStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export const MAX_DUMP_LENGTH = 5000
