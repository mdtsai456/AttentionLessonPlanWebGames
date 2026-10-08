// DCCS 端對端測試。以靜態伺服器提供 repo 根目錄，跟 Zeabur 線上部署（output_dir: "."）一致。
// DCCS_TEST_ROOT 可指向其他目錄（例如修正前的程式碼），用來確認測試能抓到 bug。

import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.DCCS_TEST_ROOT || path.resolve(here, '../..');
const port = Number(process.env.DCCS_TEST_PORT || 8790);
const fullLength = process.env.DCCS_FULL_LENGTH === '1';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  workers: 3,
  // 正式長度每關 60 秒，打到第 3 關要 3 分鐘，整場要 6 分鐘。
  timeout: fullLength ? 15 * 60_000 : 6 * 60_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    baseURL: `http://localhost:${port}`,
    // 正式長度的 trace 太大，寫檔會讓收尾逾時。
    trace: fullLength ? 'off' : 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${port} --directory "${root}"`,
    url: `http://localhost:${port}/DCCS_single/index.html`,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
