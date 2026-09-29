/**
 * Tests of a packaged application, used before a release is published.
 * `scripts/verify-packaged.mjs` prepares the application and starts them.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-packaged',
  outputDir: './test-results/packaged',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: process.env['CI'] === undefined ? 0 : 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
  use: {
    trace: 'retain-on-failure',
  },
});
