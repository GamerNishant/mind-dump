import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import { backend } from '@/data/backend'
import { DumpsStore, type DumpsState } from './dumpsStore'

const StoreContext = createContext<DumpsStore | null>(null)

export function DumpsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const store = useMemo(() => new DumpsStore(backend.dumps(userId), (message) => toast.error(message)), [userId])

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useDumpsStore(): DumpsStore {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useDumpsStore must be used inside DumpsProvider')
  return store
}

export function useDumpsState(): DumpsState {
  const store = useDumpsStore()
  return useSyncExternalStore(store.subscribe, store.getState)
}
