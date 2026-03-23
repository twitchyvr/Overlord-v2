/**
 * Overlord v2 — Playwright E2E Test Configuration
 *
 * Configures browser testing against the live Overlord v2 server.
 * The server is started via global-setup and stopped via global-teardown.
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://localhost:4000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  /* Maximum time one test can run */
  timeout: 30_000,

  /* Maximum time expect() calls can wait */
  expect: {
    timeout: 10_000,
  },

  /* Tests share a single server — limit parallelism to avoid socket conflicts */
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,  // Sequential in CI (shared server), 2 locally

  /* Retry flaky tests once */
  retries: process.env.CI ? 1 : 0,

  /* Reporter configuration */
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'test-results/html-report' }],
  ],

  /* Global setup/teardown: start and stop the server */
  globalSetup: './tests/e2e/setup/global-setup.ts',
  globalTeardown: './tests/e2e/setup/global-teardown.ts',

  /* Shared settings for all projects */
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  /* Output directory for test artifacts */
  outputDir: 'test-results/artifacts',
});
