import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke suite. The app is a no-build static site of native ES
 * modules, so the only "server" needed is a static file server over the repo
 * root (ES modules don't load over file://).
 */
export default defineConfig({
  testDir: './e2e',
  // Serial on purpose: the whole smoke suite takes ~35s, and parallel workers
  // contend on the single static server + iCloud-Drive-backed file reads,
  // which flakes the import step.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One local retry absorbs the rare iCloud-sync stall (see outputDir note);
  // real app failures reproduce on retry and still fail the run.
  retries: process.env.CI ? 2 : 1,
  globalSetup: './e2e/global-setup.js',
  // Keep artifacts out of the repo: on a dev Mac this directory is iCloud-
  // synced, and writing traces into it mid-run stalls the very file reads the
  // suite depends on. CI overrides nothing — tmpdir works there too.
  outputDir: path.join(os.tmpdir(), 'constellation-e2e-results'),
  // Generous budgets: a cold dev machine (iCloud-backed repo, first chromium
  // spawn) can stall the first navigation well past the defaults.
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:7899',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'python3 -m http.server 7899 --bind 127.0.0.1',
    url: 'http://127.0.0.1:7899',
    reuseExistingServer: !process.env.CI,
  },
});
