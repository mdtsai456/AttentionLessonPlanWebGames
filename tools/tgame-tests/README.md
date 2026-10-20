# 勇闖迷宮瀏覽器回歸

需要 Node.js 20 以上與已安裝的 Google Chrome。從專案根目錄執行：

```sh
npm ci --prefix tools/tgame-tests
npm --prefix tools/tgame-tests test
```

可使用 `round`、`images`、`viewport`、`flow`、`leave` 篩選，例如：

```sh
npm --prefix tools/tgame-tests test -- viewport
```

測試自行啟動本機靜態伺服器，以 Chrome headless 操作實際遊戲頁面。API 存檔請求攔截為測試回覆，其他外部請求停止，不寫入正式成績。

假時鐘用於重現截止時間、動畫競態、圖片逾時與畫面暫停；PNG 載入和 SVG 解碼仍使用瀏覽器。特定案例模擬圖片請求停滯、404 或解碼延遲。涵蓋六關、後半（模擬 `/report` 回 stage 3 紀錄後從第 4 關開始，單人與雙人；雙人只有一人完成前半則從第 1 關、第 4／5 關離開不送、打完第 6 關只送 stage 6 且 `levelAccuracy` 3 個值、stage 6 送失敗離開時重送）、中場離開、結算存檔、重玩、雙人 `pairId`（UUID v4，沒有 `randomUUID` 時仍用安全亂數）、離開先在頁面內確認（取消不送成績、遊戲照常繼續且打完只存一筆；確定才存已完成關卡，存檔很慢時倒數凍結、按鍵不作答且只送一次檢查點；確定後出錯沒導頁時遊戲恢復；暫停畫面的離開同樣先確認；中場回大廳不確認；全程不得出現瀏覽器原生對話框）、讀不到 CSV 時的預設題目，以及支援寬度的介面交集檢查。效能與實體裝置卡頓需另用真實時間量測。
