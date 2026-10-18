import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import { backend } from '@/data/backend'
import { ALL_KINDS, DEFAULT_SETTINGS, emptyDayPlan, type TileMeta } from '@/domain/plan'
import { useNow } from '@/hooks/useNow'
import {
  activeFocus,
  addDays,
  capUsage,
  dayPlanOf,
  floorDots,
  hourLogOf,
  itemsForDay,
  nextItem,
  planDay,
  planRollover,
  settingsOf,
  tileMetaMap,
} from '@/lib/plan'
import { useDumpsState, useDumpsStore } from './DumpsProvider'
import { Planner } from './planner'
import { PlannerStore, type PlannerState } from './plannerStore'

/** Dated planner documents older than this aren't loaded (stats and dots only need recent days). */
const HISTORY_DAYS = 45

const PlannerContext = createContext<Planner | null>(null)

/** Must sit inside DumpsProvider (routines and "+ Today" read the dumps store). */
export function PlannerProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const dumps = useDumpsStore()
  const planner = useMemo(() => {
    const store = new PlannerStore(
      backend.planner(userId),
      ALL_KINDS,
      () => addDays(planDay(new Date()), -HISTORY_DAYS),
      (message) => toast.error(message),
    )
    return new Planner(store, dumps)
  }, [userId, dumps])

  useEffect(() => {
    planner.store.start()
    return () => planner.store.stop()
  }, [planner])

  return (
    <PlannerContext.Provider value={planner}>
      <RolloverRunner planner={planner} />
      {children}
    </PlannerContext.Provider>
  )
}

export function usePlanner(): Planner {
  const planner = useContext(PlannerContext)
  if (!planner) throw new Error('usePlanner must be used inside PlannerProvider')
  return planner
}

export function usePlannerState(): PlannerState {
  const planner = usePlanner()
  return useSyncExternalStore(planner.store.subscribe, planner.store.getState)
}

/**
 * Applies the day rollover (carry-overs, routine items, closing unresolved routines) whenever the
 * planner day changes or new data arrives. Each write is attempted once per session, so a
 * failing write can't loop.
 */
function RolloverRunner({ planner }: { planner: Planner }) {
  const { docs, status } = usePlannerState()
  const { active, activeStatus } = useDumpsState()
  const now = useNow()
  const attempted = useRef(new Set<string>())

  useEffect(() => {
    if (status !== 'ready' || activeStatus !== 'ready') return
    const today = planDay(now, settingsOf(docs, DEFAULT_SETTINGS).dayStartHour)
    const plan = planRollover({ docs, today, activeDumps: active })
    const key = (id: string, day: string | null) => `${today}:${id}:${day}`
    const updates = plan.updates.filter((d) => !attempted.current.has(key(d.id, d.day)))
    const creates = plan.creates.filter((d) => !attempted.current.has(key(d.id, d.day)))
    for (const d of [...updates, ...creates]) attempted.current.add(key(d.id, d.day))
    if (updates.length) void planner.store.put(updates, "Couldn't carry over yesterday's items")
    if (creates.length) void planner.store.create(creates, "Couldn't add today's routines")
  }, [docs, status, active, activeStatus, now, planner])

  return null
}

/** Everything the Today screen and the board need about the current planner day. */
export function useToday() {
  const { docs, status } = usePlannerState()
  const { active } = useDumpsState()
  const now = useNow(30_000)
  return useMemo(() => {
    const settings = settingsOf(docs, DEFAULT_SETTINGS)
    const today = planDay(now, settings.dayStartHour)
    const tomorrow = addDays(today, 1)
    const items = itemsForDay(docs, today)
    const metas: Map<string, TileMeta> = tileMetaMap(docs)
    const inToday = new Set(items.filter((i) => i.data.status !== 'skipped' && i.data.dumpId).map((i) => i.data.dumpId!))
    const yesterdayPlan = dayPlanOf(docs, addDays(today, -1), emptyDayPlan)
    const dots = floorDots(docs, today, emptyDayPlan)
    return {
      status,
      now,
      today,
      tomorrow,
      settings,
      items,
      tomorrowItems: itemsForDay(docs, tomorrow),
      next: nextItem(items),
      usage: capUsage(items),
      metas,
      inToday,
      plan: dayPlanOf(docs, today, emptyDayPlan),
      yesterdayPlan,
      hourLog: hourLogOf(docs, today),
      focus: activeFocus(docs),
      dots,
      /** Yesterday's Floor was missed (and the app was in use before that): "Never miss twice". */
      missedYesterday: dots[5].state === 'miss' && dots.slice(0, 5).some((d) => d.state === 'hit'),
      stale: planRollover({ docs, today, activeDumps: active }).stale,
    }
  }, [docs, status, active, now])
}

export type TodayView = ReturnType<typeof useToday>
