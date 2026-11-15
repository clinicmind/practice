import { createContext, useContext } from 'react';
import type { SupervisorApi } from './api';

export const SupervisorApiContext = createContext<SupervisorApi | null>(null);

export function useSupervisorApi(): SupervisorApi {
  const v = useContext(SupervisorApiContext);
  if (!v) throw new Error('useSupervisorApi outside the supervisor area');
  return v;
}
