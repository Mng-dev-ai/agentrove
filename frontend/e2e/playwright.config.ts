import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export const API_ORIGIN = 'http://localhost:18321';
export const STATIC_ORIGIN = 'http://localhost:18322';
export const SMOKE_DIR = path.join(os.tmpdir(), 'agentrove-smoke');
export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'smoke-password-123';
export const CHAT_TITLE = 'Smoke chat';

const API_PORT = new URL(API_ORIGIN).port;
const STATIC_PORT = new URL(STATIC_ORIGIN).port;

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  globalSetup: './seed.ts',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: STATIC_ORIGIN,
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
    viewport: { width: 1400, height: 900 },
  },
  webServer: [
    {
      command: `rm -rf "${SMOKE_DIR}" && mkdir -p "${SMOKE_DIR}/home" && python migrate.py && python seed_data.py && exec python -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: '../../backend',
      url: `${API_ORIGIN}/health`,
      timeout: 120_000,
      stdout: 'pipe',
      env: {
        DESKTOP_MODE: 'true',
        HOME: path.join(SMOKE_DIR, 'home'),
        SECRET_KEY: 'smoke-test-secret-key-0123456789abcdef',
        PORT: API_PORT,
        PYTHONPATH: '../mcp-server',
        ALLOWED_ORIGINS: STATIC_ORIGIN,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
      },
    },
    {
      command: `npx vite build --mode desktop --outDir dist-desktop && npx vite preview --outDir dist-desktop --port ${STATIC_PORT} --strictPort`,
      cwd: '..',
      url: STATIC_ORIGIN,
      timeout: 300_000,
      stdout: 'pipe',
      env: {
        VITE_API_BASE_URL: `${API_ORIGIN}/api/v1`,
        VITE_WS_URL: `${API_ORIGIN.replace('http', 'ws')}/api/v1/ws`,
      },
    },
  ],
});
