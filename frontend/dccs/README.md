# 賽道攔截 DCCS

完整遊戲規格見 [`SPEC.md`](./SPEC.md)。本檔只說明「怎麼跑起來」與
「其他頁面怎麼呼叫」。路徑一律相對於 repo 根目錄。

## 目錄

```
backend/serve.py            ← 靜態伺服器 + 成績接收（純標準函式庫）
backend/results/            ← 成績 txt 輸出（自動建立）
tools/build_manifest.py     ← 讀 levels.json + 掃 assets/，產生 manifest.json
frontend/dccs/              ← 本遊戲（index.html / double.html / js / css / assets）
```

## 1. 產生 manifest.json

關卡的唯一來源是 `frontend/dccs/levels.json`（人工維護的關卡設計表，見
`SPEC.md` 第 5.1 節）；`assets/` 只提供每一關指定的素材。兩者只要有變動，
都要重新產生一次：

```bash
python3 tools/build_manifest.py
```

終端會印出各關卡的出題可行性表；不可行的關卡同時會寫進 `manifest.json`
的 `warnings` 陣列。`manifest.json` 裡每張圖的 `src` 是**相對路徑**
（例如 `assets/2/xxx.png`，不以 `/` 開頭），實際網址由前端以
`new URL(src, assetBase)` 算出，`assetBase` 預設是 `frontend/dccs/`。

## 2. 啟動伺服器（開發／除錯用）

```bash
python3 backend/serve.py             # 預設監聽 8000
python3 backend/serve.py --port 9000 # 自訂 port
```

- `http://127.0.0.1:8000/` 會 302 導向 `/frontend/dccs/index.html`
  （query string 原封不動帶過去）。
- 任何指向 `backend/` 的請求一律回 `403`（不把伺服器原始碼與成績檔
  透過瀏覽器暴露出去）；路徑含 `..` 的請求同樣回 `403`。

### 帶入受試者資訊（URL 參數）

`grade`、`caseId`、`school`、`currentDay` 四個 query 參數齊全才會直接開始，
缺任一項會顯示表單讓使用者手動輸入。另可加 `seed` 固定亂數種子：

```
http://127.0.0.1:8000/?grade=G1&caseId=S03&school=KMU&currentDay=1&seed=42
```

## 3. 其他頁面怎麼呼叫

真正的整合入口是 `frontend/dccs/js/dccs.js` 匯出的 `mountDCCS()`，
`index.html` 只是「不靠其他頁面也能自己跑一場」的殼（見 `SPEC.md` 4.14）。

```html
<script type="module">
  import { mountDCCS } from './dccs/js/dccs.js';

  const handle = mountDCCS({
    container: document.getElementById('game-root'),
    student: { grade: 'G1', caseId: 'S03', school: 'KMU', currentDay: 1 },
  });

  const result = await handle.done;   // 成績已由遊戲自己送出，這裡再拿一份
</script>
```

完整簽名與行為見 `SPEC.md` 4.15 節。同一頁可以掛兩個 `mountDCCS` 實例
（不同 `container`、不同 `bindings`），兩邊完全獨立。

## 4. 成績存在哪

一場結束後，遊戲會把整包結果 `POST` 到 `submitUrl`（獨立執行時預設
`/api/results`），`serve.py` 收到後依 `SPEC.md` 第 6 節格式寫成：

```
backend/results/<YYYYMMDD-HHMMSS>_<grade>_<caseId>_<school>.txt
```

送出失敗（例如伺服器沒開）時，資料會暫存在瀏覽器的 `localStorage`
（key 前綴 `dccs_pending_`），不會遺失。
