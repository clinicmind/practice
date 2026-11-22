import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequireSupervisor } from './auth/AuthGate';
import type { Backend } from './auth/supabase';
import { Layout } from './components/Layout';
import { LocaleProvider } from './i18n';
import type { ProgressStore } from './progress/types';
import { AuthCallback } from './routes/AuthCallback';
import { DrillsPage } from './routes/DrillsPage';
import { HomePage } from './routes/HomePage';
import { JoinPage } from './routes/JoinPage';
import { LoginPage } from './routes/LoginPage';
import { LevelGate, ModuleGate } from './routes/ModuleGate';
import { ModulePage } from './routes/ModulePage';
import { NotFound } from './routes/NotFound';
import { ReportsProvider, useReportsEnabled, type ReportsApi } from './reports/ReportsContext';
import { NewReportPage } from './routes/reports/NewReportPage';
import { ReflectPage } from './routes/ReflectPage';
import { StagePage } from './routes/StagePage';
import { CohortPage } from './routes/supervisor/CohortPage';
import { StudentPage } from './routes/supervisor/StudentPage';
import { WalkthroughPage } from './routes/WalkthroughPage';
import { DEFAULT_STAGE } from './stages';

/** Old bookmarks: /m/:slug/... lived before stages existed, and all of it was foundations. */
function LegacyModuleRedirect() {
  const { slug = '', '*': rest = '' } = useParams();
  const { search, hash, state } = useLocation();
  const tail = rest ? `/${rest}` : '';
  return <Navigate to={`/s/${DEFAULT_STAGE}/m/${slug}${tail}${search}${hash}`} replace state={state} />;
}

/**
 * `store` is the local (browser) store. `backend` is the Supabase client, or
 * null/undefined for local mode, where the app behaves exactly as in phase 1.
 * `storage` is the Storage `store` writes to; it is cleared after a successful import.
 */
export function App({ store, wasReset, backend = null, storage = globalThis.localStorage, reportsEnabled = false, reportsApi }: {
  store: ProgressStore; wasReset?: boolean; backend?: Backend | null; storage?: Storage;
  /** Reports are hidden unless this is true: no link, and the report routes do not exist. */
  reportsEnabled?: boolean; reportsApi?: Partial<ReportsApi>;
}) {
  return (
    <ReportsProvider enabled={reportsEnabled} api={reportsApi}>
      <AppRoutes store={store} wasReset={wasReset} backend={backend} storage={storage} />
    </ReportsProvider>
  );
}

function AppRoutes({ store, wasReset, backend, storage }: {
  store: ProgressStore; wasReset?: boolean; backend: Backend | null; storage: Storage;
}) {
  const reports = useReportsEnabled();
  return (
    <LocaleProvider>
    <AuthProvider backend={backend}>
      <Layout wasReset={wasReset}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<RequireAuth store={store} backend={backend} storage={storage} />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/s/:stage" element={<StagePage />} />
            <Route path="/s/:stage/m/:slug" element={<ModuleGate><ModulePage /></ModuleGate>} />
            <Route path="/s/:stage/m/:slug/walkthrough/:sessionId" element={<ModuleGate><WalkthroughPage /></ModuleGate>} />
            <Route path="/s/:stage/m/:slug/drills/:level" element={<ModuleGate><LevelGate><DrillsPage /></LevelGate></ModuleGate>} />
            <Route path="/s/:stage/m/:slug/reflect" element={<ModuleGate><ReflectPage /></ModuleGate>} />
            <Route path="/m/:slug/*" element={<LegacyModuleRedirect />} />
            {reports && <Route path="/reports/new" element={<NewReportPage />} />}
            <Route path="/supervisor" element={<RequireSupervisor><CohortPage /></RequireSupervisor>} />
            <Route path="/supervisor/students/:id" element={<RequireSupervisor><StudentPage /></RequireSupervisor>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Layout>
    </AuthProvider>
    </LocaleProvider>
  );
}
