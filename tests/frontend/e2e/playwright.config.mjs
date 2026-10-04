// 前端 E2E：用 python http.server 直接提供 repo 根目錄（同 Zeabur 靜態部署）。
import { defineConfig } from "@playwright/test";
import { SITE_ROOT } from "../site.mjs";

// 預設不用 8000/8765 這類常見 port，避免連到別的 workspace 開著的伺服器。
const PORT = Number(process.env.E2E_PORT || 18931);

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  // 每個測試都要開整頁遊戲（大圖、字型），機器忙時光啟動瀏覽器就要十幾秒。
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
    // port 被佔用就直接失敗，不要誤測到別人的伺服器。
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "ignore",
  },
});
