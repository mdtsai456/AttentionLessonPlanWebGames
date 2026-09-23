# 賽道攔截 DCCS

完整遊戲規格見 [`SPEC.md`](./SPEC.md)。本檔只說明「怎麼跑起來」與
「其他頁面怎麼呼叫」。路徑一律相對於 repo 根目錄。

## 目錄

```
backend/                    ← 中介平台（FastAPI）。也負責提供前端，掛在 /app
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

## 2. 啟動（開發／除錯用）

前端由中介平台後端一併提供，**不需要另外起靜態伺服器**：

```bash
cd backend
uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001
```

- 入口 `http://127.0.0.1:5001/app/`（登入頁）
- 遊戲大廳 `http://127.0.0.1:5001/app/games.html`
- 本遊戲 `http://127.0.0.1:5001/app/dccs/index.html`

後端只把 `frontend/` 這個目錄掛出去，後端原始碼與 `.env` 不在其中。因為與
`/api/*` 同源，**不需要設定任何 CORS**。

### 帶入受試者資訊（URL 參數）

從大廳進來時不需要（見下節）。直接開遊戲頁除錯時，`grade`、`caseId`、
`school`、`currentDay` 四個參數齊全才會直接開始，缺任一項會顯示表單。
另可加 `seed` 固定亂數種子：

```
http://127.0.0.1:5001/app/dccs/index.html?grade=G1&caseId=S03&school=KMU&currentDay=1&seed=42
```

## 2b. 從遊戲大廳進場

學生在 `frontend/index.html` 登入、於 `frontend/games.html` 點「開始挑戰」
之後，會被導到 `dccs/index.html`（雙人為 `dccs/double.html`）。

受試者資料**不經 URL 傳遞**——大廳與遊戲同源，遊戲自己讀 `sessionStorage`
（見 `js/lobby.js`）。`currentDay` 由遊戲向中介平台查既有場次推導；推導
失敗會退回手動表單並把已知欄位填好，不會猜值。玩完自動導回大廳。

要接上新遊戲，在 `frontend/games.html` 的 `GAME_PAGES` 加一行即可。
詳見 `docs/dccs-lobby-handoff.md`。

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

一場結束後，遊戲把整包結果 `POST` 到中介平台的 `POST /api/sessions`，
由後端寫進 MariaDB。

端點由 `js/net/apiBase.js` 解析，**單人與雙人共用**：

| 優先序 | 來源 | 用途 |
|---|---|---|
| 1 | `window.DCCS_SUBMIT_URL` | 整支端點覆寫 |
| 2 | `window.API_BASE_URL` | 只換 API 前綴，端點仍是 `<base>/sessions` |
| 3 | 同源 `${location.origin}/api/sessions` | 預設 |

因為前端就是後端提供的，第 3 條必然正確——本機、正式站、之後換網域都不用
改程式碼，也不可能發生「本機測試把成績灌進正式庫」。

### 送失敗怎麼辦

送不出去時整包 JSON 暫存在瀏覽器的 `localStorage`（key 前綴
`dccs_pending_`）。**下次開啟遊戲時會自動重送**（每次載入只跑一次，成功的
才刪掉），所以後端或資料庫短暫不通都不會掉資料。
