import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { getSupabase } from './auth/supabase';
import { createLocalStore } from './progress/localStore';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App store={store} wasReset={store.wasReset} backend={getSupabase()} />
    </BrowserRouter>
  </StrictMode>,
);
