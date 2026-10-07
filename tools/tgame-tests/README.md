# 勇闖迷宮瀏覽器回歸

需要 Node.js 20 以上與已安裝的 Google Chrome。從專案根目錄執行：

```sh
npm ci --prefix tools/tgame-tests
npm --prefix tools/tgame-tests test
```

可使用 `round`、`images`、`viewport`、`flow` 篩選，例如：

```sh
npm --prefix tools/tgame-tests test -- viewport
```

測試自行啟動本機靜態伺服器，以 Chrome headless 操作實際遊戲頁面。API 存檔請求攔截為測試回覆，其他外部請求停止，不寫入正式成績。

假時鐘用於重現截止時間、動畫競態、圖片逾時與畫面暫停；PNG 載入和 SVG 解碼仍使用瀏覽器。特定案例模擬圖片請求停滯、404 或解碼延遲。涵蓋六關、中場離開、結算存檔、重玩，以及支援寬度的介面交集檢查。效能與實體裝置卡頓需另用真實時間量測。
