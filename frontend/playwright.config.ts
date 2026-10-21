import { defineConfig, devices } from '@playwright/test'

// Separate ports from the normal dev servers so E2E runs never collide with them.
const API_PORT = process.env.E2E_API_PORT ?? '8011'
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5181'
const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
// E2E_BASE_URL=https://tabulavibe-ai.vercel.app runs the same journeys against a deployment (no local servers).
const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, '')

const localServers = [
  {
    command: `${python} -m uvicorn app.main:app --host 127.0.0.1 --port ${API_PORT}`,
    cwd: '../backend',
    url: `http://127.0.0.1:${API_PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    // Ignore the developer's backend/.env (Supabase, sign-in, AI keys) so journeys are reproducible.
    env: { TABULAVIBE_AI_PROVIDER: 'none', TABULAVIBE_ENV_FILE: '' },
  },
  {
    command: `npx vite --port ${WEB_PORT} --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
  },
]

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL ?? `http://localhost:${WEB_PORT}`,
    // Uses the locally installed Google Chrome, so no separate browser download is needed.
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' } },
  ],
  webServer: BASE_URL ? [] : localServers,
})
