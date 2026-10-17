export const POSITION_STEP = 1024
/** Below this gap, bisecting further loses float precision — rewrite positions evenly instead. */
const MIN_GAP = 1e-6

export interface PositionUpdate {
  id: string
  position: number
}

interface Positioned {
  id: string
  position: number
}

export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - POSITION_STEP
  if (after === undefined) return before + POSITION_STEP
  return (before + after) / 2
}

/** Position that places a new item above everything in `items`. */
export function topPosition(items: readonly Positioned[]): number {
  if (items.length === 0) return 0
  return Math.min(...items.map((i) => i.position)) - POSITION_STEP
}

/** A position next to `position` that no other item uses (keeps the order unambiguous). */
export function freePositionNear(items: readonly Positioned[], position: number): number {
  if (!items.some((i) => i.position === position)) return position
  const above = items.filter((i) => i.position > position).map((i) => i.position)
  return above.length ? positionBetween(position, Math.min(...above)) : position + POSITION_STEP
}

/** Evenly spaced positions in the given order. */
export function rebalance(ordered: readonly Positioned[]): PositionUpdate[] {
  return ordered.map((item, index) => ({ id: item.id, position: index * POSITION_STEP }))
}

/**
 * `ordered` is the list after the move; `index` is where the moved item landed.
 * Returns the minimal set of position writes that realises that order.
 */
export function planMove(ordered: readonly Positioned[], index: number): PositionUpdate[] {
  const before = ordered[index - 1]?.position
  const after = ordered[index + 1]?.position
  const cramped = before !== undefined && after !== undefined && !(after - before > MIN_GAP)
  // Equal neighbours elsewhere mean the stored order is ambiguous — fix it while we're writing anyway.
  const tied = ordered.some((item, i) => i > 0 && !(item.position > ordered[i - 1].position) && i !== index && i - 1 !== index)
  if (cramped || tied) return rebalance(ordered)
  return [{ id: ordered[index].id, position: positionBetween(before, after) }]
}
