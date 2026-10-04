import { defineConfig } from '@playwright/test';

// 用 Python 內建的靜態伺服器提供 repo 根目錄，跟線上（zbpack static, output_dir ".")一樣的路徑結構。
// port 被別的程式佔用時直接失敗，不沿用既有伺服器，避免測到別的工作目錄的檔案。
const PORT = Number(process.env.E2E_PORT || 18431);

export default defineConfig({
  testDir: './tests',
  // 每個測試要快轉跑完六關，機器忙時會慢很多，所以放寬時間、限制同時開的瀏覽器數
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: Number(process.env.E2E_WORKERS || 2),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    cwd: process.env.E2E_ROOT || '..',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
