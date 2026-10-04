# DCCS 瀏覽器迴歸測試

測試使用真正的雙人頁面與滑鼠點擊，確認第 3 關後的「繼續遊玩」會移除共用提示，後續過關按鈕能點擊，並確認「返回遊戲大廳」仍會送出兩位玩家的成績。所有 POST 與外部請求均攔截，不寫入資料庫。

在專案根目錄啟動靜態伺服器：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

另開終端機，在專案根目錄執行：

```sh
npm install --prefix .context/pw playwright-core
PLAYWRIGHT_MODULE="$PWD/.context/pw/node_modules/playwright-core/index.mjs" node --test DCCS/tests/double-flow.test.mjs
```

預設使用 macOS 上的 Google Chrome。其他環境請設定 `CHROME_PATH` 為 Chrome 或 Chromium 的執行檔路徑。`DCCS_BASE_URL` 可覆寫伺服器網址；`DCCS_SCREENSHOT_DIR` 可指定失敗截圖目錄，Conductor 工作區請使用 `.context/`。
