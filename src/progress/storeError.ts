export type StoreErrorKind = 'network' | 'auth' | 'other';

/** A cloud store failure. `auth` means the sign-in has expired; `network` means try again. */
export class StoreError extends Error {
  constructor(public readonly kind: StoreErrorKind, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

type Failure = { message?: string; code?: string };

export function toStoreError(error: Failure, status?: number): StoreError {
  const msg = error.message ?? 'store error';
  if (status === 401 || error.code === 'PGRST301' || /jwt (expired|invalid)/i.test(msg)) return new StoreError('auth', msg);
  if (!status || /failed to fetch|network|timeout|load failed/i.test(msg)) return new StoreError('network', msg);
  return new StoreError('other', msg);
}
