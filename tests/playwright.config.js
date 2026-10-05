// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.js', 'parity/**/*.spec.js'],
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8743',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Serves the repo root (..) so /index.html is this repo's real page, and /tests/fixtures/*
  // (the vendored CDN files, read from ../vendor via a symlink-free relative fetch in mockGoogle.js)
  // are reachable too. No build step — same "static page" the app itself is.
  webServer: {
    command: 'python3 -m http.server 8743 --directory ..',
    url: 'http://127.0.0.1:8743/index.html',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
