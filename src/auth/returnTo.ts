const KEY = 'cm.returnTo';

/** Only same-site absolute paths: "/x" yes; "//host", "http://…" and "/\\host" no. */
export function safePath(p: string | null | undefined): string | null {
  if (!p || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null;
  return p;
}

/** Remembered in localStorage because the magic link usually opens in a new tab. */
export function rememberReturnTo(path: string): void {
  const ok = safePath(path);
  if (!ok || ok === '/login' || ok.startsWith('/auth/')) return;
  try { localStorage.setItem(KEY, ok); } catch { /* best effort */ }
}

export function takeReturnTo(): string | null {
  try {
    const v = safePath(localStorage.getItem(KEY));
    localStorage.removeItem(KEY);
    return v;
  } catch { return null; }
}
