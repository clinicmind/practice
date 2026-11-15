import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequireSupervisor } from './auth/AuthGate';
import type { Backend } from './auth/supabase';
import { Layout } from './components/Layout';
import type { ProgressStore } from './progress/types';
import { AuthCallback } from './routes/AuthCallback';
import { DrillsPage } from './routes/DrillsPage';
import { JoinPage } from './routes/JoinPage';
import { LoginPage } from './routes/LoginPage';
import { LevelGate, ModuleGate } from './routes/ModuleGate';
import { ModulePage } from './routes/ModulePage';
import { NotFound } from './routes/NotFound';
import { ReflectPage } from './routes/ReflectPage';
import { StagePage } from './routes/StagePage';
import { CohortPage } from './routes/supervisor/CohortPage';
import { WalkthroughPage } from './routes/WalkthroughPage';

/**
 * `store` is the local (browser) store. `backend` is the Supabase client, or
 * null/undefined for local mode, where the app behaves exactly as in phase 1.
 */
export function App({ store, wasReset, backend = null }: { store: ProgressStore; wasReset?: boolean; backend?: Backend | null }) {
  return (
    <AuthProvider backend={backend}>
      <Layout wasReset={wasReset}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<RequireAuth store={store} />}>
            <Route path="/" element={<StagePage />} />
            <Route path="/m/:slug" element={<ModuleGate><ModulePage /></ModuleGate>} />
            <Route path="/m/:slug/walkthrough/:sessionId" element={<ModuleGate><WalkthroughPage /></ModuleGate>} />
            <Route path="/m/:slug/drills/:level" element={<ModuleGate><LevelGate><DrillsPage /></LevelGate></ModuleGate>} />
            <Route path="/m/:slug/reflect" element={<ModuleGate><ReflectPage /></ModuleGate>} />
            <Route path="/supervisor" element={<RequireSupervisor><CohortPage /></RequireSupervisor>} />
            <Route path="/supervisor/*" element={<RequireSupervisor><Navigate to="/supervisor" replace /></RequireSupervisor>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Layout>
    </AuthProvider>
  );
}
