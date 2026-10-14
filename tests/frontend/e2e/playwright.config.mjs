// 前端 E2E：使用 Python 的 http.server 提供專案根目錄，與 Zeabur 靜態部署相同。
import { defineConfig } from "@playwright/test";
import { SITE_ROOT } from "../site.mjs";

// 避免預設使用 8000／8765 等常用連接埠，以免連至其他工作區的伺服器。
const PORT = Number(process.env.E2E_PORT || 18931);

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  // 每個測試都載入完整遊戲頁面，包含大型圖片與字型。主機忙碌時，啟動瀏覽器可能需要十多秒。
  workers: Number(process.env.E2E_WORKERS || 4),
  timeout: 90_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `node "${new URL("../server.mjs", import.meta.url).pathname}"`,
    url: `http://127.0.0.1:${PORT}/Home/index.html`,
    // 連接埠已被使用時，立即失敗，避免測試其他伺服器。
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
  },
});
