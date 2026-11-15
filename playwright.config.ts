import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// The app is built against the fixture content, never against the real course content.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `CONTENT_DIR=tests/fixtures/content/ok-reviewed npm run build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
