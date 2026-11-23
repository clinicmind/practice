import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { buildContent } from '../../scripts/build-content';
import { App } from '../App';
import { resetContentCache } from '../content/client';
import { createLocalStore } from '../progress/localStore';
import type { ReportsApi } from '../reports/ReportsContext';
import type { FakeBackend } from './fakeSupabase';

export class Mem implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const FIXTURES = join(__dirname, '..', '..', 'tests', 'fixtures', 'content');

/** Build a fixture course the way `npm run content` would. */
export async function buildFixture(name: 'ok' | 'ok-reviewed' | 'multi', opts: { includeUnreviewed?: boolean } = {}): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), `fx-${name}-`));
  for (const locale of ['en', 'zh-Hant'] as const) {
    await buildContent({ contentDir: join(FIXTURES, name), outDir: out, locale, includeUnreviewed: opts.includeUnreviewed });
  }
  return out;
}

/** Serve a built fixture over a stubbed fetch, as the static host would. */
export function serve(dir: string) {
  resetContentCache();
  vi.stubGlobal('fetch', async (url: string) => {
    const m = String(url).match(/content\/(.*)$/);
    const file = m ? join(dir, m[1]) : '';
    if (!m || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file, 'utf8'), { status: 200 });
  });
}

export const spy = { path: '' };
export function PathSpy() { spy.path = useLocation().pathname; return null; }

export function renderCloud(url: string, fake: FakeBackend, opts: { reportsEnabled?: boolean; reportsApi?: Partial<ReportsApi> } = {}) {
  const storage = new Mem();
  return render(
    <MemoryRouter initialEntries={[url]}>
      <App store={createLocalStore(storage)} storage={storage} backend={fake.backend} reportsEnabled={opts.reportsEnabled} reportsApi={opts.reportsApi} />
      <PathSpy />
    </MemoryRouter>,
  );
}
