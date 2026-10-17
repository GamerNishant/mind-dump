import { useState } from 'react'
import { HardDrive, X } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'

const KEY = 'minddump:local-banner-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Explains device-only mode, shown when no cloud backend is configured. */
export function LocalModeBanner() {
  const { backendKind } = useAuth()
  const [dismissed, setDismissed] = useState(wasDismissed)
  if (backendKind !== 'local' || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // Non-fatal.
    }
  }

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm sm:px-6">
        <HardDrive className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Device-only mode.</span> Your dumps are saved in this browser and won't sync to
          other devices.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-amber-500/15"
          aria-label="Dismiss"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
