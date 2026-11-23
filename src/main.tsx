import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { getSupabase } from './auth/supabase';
import { createLocalStore } from './progress/localStore';
import { reportsFlag, type ReportsApi } from './reports/ReportsContext';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/noto-serif-tc/400.css';
import '@fontsource/noto-serif-tc/700.css';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/600.css';
import './styles.css';

const store = createLocalStore();

// Reports are off unless the build sets VITE_REPORTS_ENABLED=true. The production build does not.
const reportsEnabled = reportsFlag(import.meta.env);

async function start() {
  // End-to-end builds only: a stand-in backend, so the screens can be driven without Edge Functions.
  // The condition is replaced at build time, so the fake never reaches a normal build.
  let reportsApi: Partial<ReportsApi> | undefined;
  if (import.meta.env.VITE_REPORTS_FAKE_API === 'true') {
    reportsApi = (await import('./reports/fakeApi')).createFakeApi();
  } else if (import.meta.env.VITE_REPORTS_ENABLED === 'true') {
    // The real backend (the `reports` Edge Function). Like the line above, this condition is replaced at
    // build time, so none of it is in a normal build. See docs/SETUP-reports.md before turning it on.
    const sb = getSupabase();
    if (sb) {
      const { createCloudReportsApi } = await import('./reports/cloudApi');
      reportsApi = createCloudReportsApi({
        url: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        getToken: async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
      });
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App store={store} wasReset={store.wasReset} backend={getSupabase()} reportsEnabled={reportsEnabled} reportsApi={reportsApi} />
      </BrowserRouter>
    </StrictMode>,
  );
}
void start();
