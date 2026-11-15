import '@testing-library/jest-dom/vitest';

// Unsaved drill drafts live in sessionStorage; never let them leak between tests.
import { afterEach } from 'vitest';
afterEach(() => { try { sessionStorage.clear(); } catch { /* not available */ } });
