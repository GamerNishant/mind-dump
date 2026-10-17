import { defineConfig, devices } from '@playwright/test'

const PORT = 5190

// Smoke test of a production build (GitHub Pages sub-path) against the real Supabase project in .env.
// Run manually: npx playwright test -c playwright.cloud.config.ts
export default defineConfig({
  testDir: 'e2e-cloud',
  reporter: [['list']],
  timeout: 90_000,
  use: { baseURL: `http://localhost:${PORT}/mind-dump/`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/mind-dump/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_BASE: '/mind-dump/' },
  },
})
