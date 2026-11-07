import { defineConfig, devices } from '@playwright/test';

// Chrome and Safari's engine, at laptop and phone sizes. BASE_URL points the same tests at a deployed site.
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: process.env.BASE_URL ? undefined : { command: 'node tools/serve.mjs', url: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'chrome-laptop', use: { browserName: 'chromium', viewport: { width: 1440, height: 800 } } },
    { name: 'chrome-phone', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'safari-laptop', use: { browserName: 'webkit', viewport: { width: 1440, height: 800 } } },
    { name: 'safari-phone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
