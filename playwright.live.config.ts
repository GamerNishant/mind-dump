import { defineConfig, devices } from '@playwright/test'

// Smoke test of the deployed site (GitHub Pages) against the real Supabase backend.
// Run manually after a deploy: npx playwright test -c playwright.live.config.ts
export default defineConfig({
  testDir: 'e2e-cloud',
  reporter: [['list']],
  timeout: 90_000,
  use: { baseURL: 'https://gamernishant.github.io/mind-dump/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
