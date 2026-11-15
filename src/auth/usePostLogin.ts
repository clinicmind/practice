import { useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { safePath, takeReturnTo } from './returnTo';

/** Where a user who just signed in should go, or null while that is not known yet. */
export function usePostLoginTarget(): string | null {
  const { status } = useAuth();
  const from = safePath((useLocation().state as { from?: string } | null)?.from);
  switch (status) {
    case 'supervisor': takeReturnTo(); return '/supervisor';
    case 'needsCohort': return '/join';
    case 'student': return from ?? takeReturnTo() ?? '/';
    case 'local': return '/';
    default: return null;
  }
}
