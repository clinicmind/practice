import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { createLocalStore } from './progress/localStore';
import './styles.css';

const store = createLocalStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App store={store} wasReset={store.wasReset} />
    </BrowserRouter>
  </StrictMode>,
);
