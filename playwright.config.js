import { defineConfig, devices } from '@playwright/test';

// e2e: เริ่มเซิร์ฟเวอร์ทดสอบ (พอร์ต 3199, ฐานข้อมูลชั่วคราว, ไฟล์ที่ build แล้วใน dist/) แล้วรันเบราว์เซอร์จริง
// รัน: npm run e2e   (ต้องติดตั้งเบราว์เซอร์ก่อน 1 ครั้ง: npx playwright install chromium firefox)
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/.tmp/results',
  use: { baseURL: 'http://localhost:3199', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'node scripts/build.js && node e2e/server.mjs',
    url: 'http://localhost:3199/healthz',
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
