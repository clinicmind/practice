import { createContext, useContext, type ReactNode } from 'react';
import type { ProgressStore } from './progress/types';

const StoreContext = createContext<ProgressStore | null>(null);

export function StoreProvider({ store, children }: { store: ProgressStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): ProgressStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}
