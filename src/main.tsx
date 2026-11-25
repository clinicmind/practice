import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { getSupabase, type Backend } from './auth/supabase';
import { createLocalStore } from './progress/localStore';
import { aiFlag, type AiFeedbackClient } from './ai/AiContext';
import { extrasFlag } from './extras/ExtrasContext';
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
// AI feedback is off unless the build sets VITE_AI_ENABLED=true. The production build does not.
const aiEnabled = aiFlag(import.meta.env);
// The optional student extras are off unless the build sets VITE_PRACTICE_EXTRAS=true. The production build does not.
const extrasEnabled = extrasFlag(import.meta.env);

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
        getUserId: async () => (await sb.auth.getSession()).data.session?.user.id ?? null,
      });
    }
  }
  let backend: Backend | null = getSupabase();
  let aiClient: AiFeedbackClient | undefined;
  if (import.meta.env.VITE_AI_FAKE_API === 'true') {
    // End-to-end builds only, like the reports stand-in above: removed from a normal build at build time.
    const { createFakeAiClient } = await import('./ai/fakeApi');
    // The page may ask for a seeded supervisor session, so the supervisor screens can be driven without Supabase.
    const fakeUser = sessionStorage.getItem('e2e-fake-user');
    if (fakeUser === 'sup') {
      backend = (await import('./ai/fakeBackend')).createSeededSupervisorBackend();
      aiClient = createFakeAiClient(async () => null);
    } else if (fakeUser === 'sup-triage') {
      backend = (await import('./supervisor/fakeTriageBackend')).createTriageSupervisorBackend();
      aiClient = createFakeAiClient(async () => null);
    }
    aiClient ??= createFakeAiClient(async (id) => (await store.listAttempts()).find((a) => a.id === id)?.response ?? null);
  } else if (import.meta.env.VITE_AI_ENABLED === 'true') {
    // The real client (the `ai-feedback` Edge Function). Only with a Supabase backend: local mode has no attempts on the server.
    const sb = getSupabase();
    if (sb) {
      const { createCloudAiClient } = await import('./ai/cloudApi');
      aiClient = createCloudAiClient({
        url: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        getToken: async () => (await sb.auth.getSession()).data.session?.access_token ?? null,
      });
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App store={store} wasReset={store.wasReset} backend={backend} reportsEnabled={reportsEnabled} reportsApi={reportsApi} aiEnabled={aiEnabled} aiClient={aiClient} extrasEnabled={extrasEnabled} />
      </BrowserRouter>
    </StrictMode>,
  );
}
void start();
