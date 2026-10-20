import { ALL_KINDS } from '@/domain/plan'
import type { PlannerDoc } from '@/domain/planner'
import type { AppUser } from '@/domain/user'
import type { Backend } from './types'

const PAGE = 500

/**
 * Everything the account has, as one JSON backup: board tiles, history, and every planner
 * document (Today items, habits, hour logs, rules, settings), with no date cut-off.
 */
export async function buildExport(backend: Backend, user: AppUser) {
  const dumps = backend.dumps(user.id)
  const active = await dumps.listActive()
  const done = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await dumps.listDone({ offset, limit: PAGE })
    done.push(...page.items)
    if (!page.hasMore || page.items.length === 0) break
  }
  // The planner table may not be set up yet (cloud mode); the tiles are still worth saving.
  let planner: PlannerDoc[] = []
  let plannerAvailable = true
  try {
    planner = await backend.planner(user.id).list({ kinds: ALL_KINDS, sinceDay: '0000-01-01' })
  } catch {
    plannerAvailable = false
  }
  return {
    app: 'mind-dump',
    version: 1,
    exportedAt: new Date().toISOString(),
    user: { email: user.email, displayName: user.displayName },
    dumps: { active, done },
    planner,
    plannerAvailable,
  }
}

/** Build the backup and hand it to the browser as a download. */
export async function downloadExport(backend: Backend, user: AppUser): Promise<void> {
  const data = await buildExport(backend, user)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mind-dump-backup-${data.exportedAt.slice(0, 10)}.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
