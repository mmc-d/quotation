import { defineConfig } from 'vitest/config';

const DB = 'mmc_e2e';
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    sequence: { concurrent: false },
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `postgres://mmc_app:mmc_app_dev_only@localhost:5433/${DB}`,
      DATABASE_ADMIN_URL: `postgres://mmc:mmc_dev_only@localhost:5433/${DB}`,
      WEB_ORIGIN: 'http://localhost:3999',
      PUBLIC_BASE_URL: 'http://localhost:3999',
      BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123',
      FILES_DIR: '/tmp/mmc-e2e-files',
      WORKER_IN_PROCESS: 'false',
      GOTENBERG_URL: 'http://localhost:3300',
      ERPNEXT_WEBHOOK_SECRET: 'erp-e2e',
    },
  },
});
