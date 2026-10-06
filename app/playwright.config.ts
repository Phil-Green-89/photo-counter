import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // Phone-sized, touch-enabled: the app is built for this
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    // Fake backend config so the consent + upload path is exercised (requests are mocked in the tests)
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    env: { VITE_SUPABASE_URL: 'https://demo.supabase.co', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
