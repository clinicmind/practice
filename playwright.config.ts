import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const REPORTS_PORT = 4174;
const REAL_PORT = 4175; // real content, normal build: no EFT stage
const EFT_PORT = 4176; // real content with EFT module 1 registered as reviewed (test-only)

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
  webServer: [
    {
      // The normal build: what the live site looks like. Reports are off.
      // The second build (reports on, stand-in backend) reuses the content this one generated.
      command: `rm -rf dist-reports dist-real dist-eft && CONTENT_DIR=tests/fixtures/content/ok-reviewed npm run build && VITE_REPORTS_ENABLED=true VITE_REPORTS_FAKE_API=true npx vite build --outDir dist-reports --emptyOutDir && e2e/build-variants.sh && touch dist-reports/.ready && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // The reports-on build, served once the first command has finished building it.
      command: `until [ -f dist-reports/.ready ]; do sleep 1; done; npx vite preview --outDir dist-reports --host 127.0.0.1 --port ${REPORTS_PORT} --strictPort`,
      url: `http://127.0.0.1:${REPORTS_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // Real content, normal build: the live site as it is today. The EFT stage must not exist.
      command: `until [ -f dist-reports/.ready ]; do sleep 1; done; npx vite preview --outDir dist-real --host 127.0.0.1 --port ${REAL_PORT} --strictPort`,
      url: `http://127.0.0.1:${REAL_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      // Real content with EFT module 1 registered as reviewed: the stage shows.
      command: `until [ -f dist-reports/.ready ]; do sleep 1; done; npx vite preview --outDir dist-eft --host 127.0.0.1 --port ${EFT_PORT} --strictPort`,
      url: `http://127.0.0.1:${EFT_PORT}/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
