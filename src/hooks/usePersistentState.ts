import { useCallback, useEffect, useState } from 'react'

function read<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return validate(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

/** useState backed by localStorage (per-device preference, e.g. sort order). */
export function usePersistentState<T>(key: string, fallback: T, validate: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => read(key, fallback, validate))

  // Re-read when the key changes (e.g. a different user signs in).
  useEffect(() => {
    setValue(read(key, fallback, validate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Non-fatal.
      }
    },
    [key],
  )

  return [value, update] as const
}
