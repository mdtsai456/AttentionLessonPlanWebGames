// DCCS E2E 測試。靜態伺服器提供專案根目錄，與 Zeabur 部署設定 output_dir: "." 相同。
// DCCS_TEST_ROOT 可指定其他目錄，例如修正前的程式碼，以確認測試能偵測錯誤。

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
  // 正式長度為每關 60 秒。完成第 3 關需 3 分鐘，整場需 6 分鐘。
  timeout: fullLength ? 15 * 60_000 : 6 * 60_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    baseURL: `http://localhost:${port}`,
    // 正式長度的 trace 檔案較大，寫入時可能使測試結束流程逾時。
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
