import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import type { ProgressStore } from './progress/types';
import { DrillsPage } from './routes/DrillsPage';
import { LevelGate, ModuleGate } from './routes/ModuleGate';
import { ModulePage } from './routes/ModulePage';
import { NotFound } from './routes/NotFound';
import { ReflectPage } from './routes/ReflectPage';
import { StagePage } from './routes/StagePage';
import { WalkthroughPage } from './routes/WalkthroughPage';
import { StoreProvider } from './StoreContext';

export function App({ store, wasReset }: { store: ProgressStore; wasReset?: boolean }) {
  return (
    <StoreProvider store={store}>
      <Layout wasReset={wasReset}>
        <Routes>
          <Route path="/" element={<StagePage />} />
          <Route path="/m/:slug" element={<ModuleGate><ModulePage /></ModuleGate>} />
          <Route path="/m/:slug/walkthrough/:sessionId" element={<ModuleGate><WalkthroughPage /></ModuleGate>} />
          <Route path="/m/:slug/drills/:level" element={<ModuleGate><LevelGate><DrillsPage /></LevelGate></ModuleGate>} />
          <Route path="/m/:slug/reflect" element={<ModuleGate><ReflectPage /></ModuleGate>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </StoreProvider>
  );
}
