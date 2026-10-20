# 瓢蟲追擊令・雙人

左右各一位玩家，規則與單人相同。選單、資料夾與成績代號都是 `DAT`。單人的題型、秒數與動物升級見 [`../DAT_single/README.md`](../DAT_single/README.md)。

## 和單人的差別

| 玩家 | 移動 | 作答 |
| --- | --- | --- |
| 玩家 1（左） | `W` `A` `S` `D` | 空白鍵 |
| 玩家 2（右） | 方向鍵 | Enter |

兩人各自出題、計分、連擊與動物圖。換關不重置已經升過的動物。

練習是 `?mode=practice`，每人 2 題，顏色與數學各一題。正式是 `?mode=game`，6 關、每關 60 秒，顏色與數學每題隨機。

第 3 關結束要等兩人都到，才一起選繼續或回大廳。成績各送一筆，`lessonId` 為 `1140908_DAT`，`mode` 為 `double`，並共用一組 `pairId`（每局開始時由 `shared/api.js` 的 `WebGameApi.uuid()` 產生）。

兩人今天都已在雙人模式打完前 3 關（不必是同一位搭檔），正式開始時兩人直接從第 4 關開始；只有一人符合就兩人都從第 1 關。判定在 `shared/second-half.js`，各用自己的 token 讀報表，最多等 5 秒，查不到就從第 1 關。直接進正式模式、或練習完按「進入正式遊戲」都會查；練習本身不查。這一局用新的 `pairId` 與 submissionId，統計從 0 算起，只含第 4～6 關，不會出現中場。第 4、5 關離開什麼都不送；打完第 6 關各送一筆 stage 6，`DAT_levelAccuracy` 只有 3 個值（第 4、5、6 關），之後離開的重送照舊。「再玩一次」是從第 1 關開始的新一局。

按「離開」（或還有人沒打完時按結算的「返回遊戲大廳」）會先在畫面上問「確定要離開嗎？」。按「繼續遊戲」或 Esc 什麼都不送；按「離開」才替兩人存第 3 關檢查點（有打到的話）再回選遊戲頁。確定後到導頁前遊戲維持暫停，按鍵與作答鈕都不算，存檔期間不會打完下一關多送一筆；存檔請求最多等 10 秒，暫停中照樣會逾時。已經送過第 6 關成績的玩家不會再送第 3 關：已儲存就當作完成，結果未確認或失敗就改重送那筆第 6 關。每筆成績帶 `data.submissionId`（`WebGameApi.uuid()`），重送沿用同一筆，後端回同一個 `sessionId`，不會多一列；結果未確認也可以重試。按離開時還沒存好的成績（包含兩人都打完六關後的最終成績）會先用同一個 submissionId 重送；任一人仍沒存成功就留在遊戲頁，遊戲恢復進行，可以按「重試儲存」或再按一次「離開」。兩人都打完六關，或在第 3 關中場按「返回遊戲大廳」，不再確認。從這些按鈕離開不會跳出瀏覽器的離開詢問；遊戲中直接關分頁仍會。

## 動物圖

兩人各打一次素材平台，圖的順序來自：

`https://attention-lesson-plan-assets.zeabur.app/api/students/{學生ID}/assets`

玩家 1 用 `student1_case`，玩家 2 用 `student2_case`。個案編號補成三位數，例如 `S01` 打成 `S001`。網址不含年級與場域。回應由 `shared/dat-assets.js` 的 `fetchAssetList` 讀 `DAT.assets.files`。沒有客製圖、請求失敗，或只有一張時，那位玩家用 `assets/animals/` 的兔子、貓、狗、鳥補上。圖片要載入完成才換上去。素材平台的上傳圖是跨來源圖片，以 CORS（`crossOrigin = 'anonymous'`）載入，命中判定才讀得到圖片透明度；伺服器不給 CORS 時仍照常顯示，命中只算中央圓。

成績裡的 `caseId` 仍用原本的編號，不補成三位數。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `DAT_double.html` | 雙人畫面 |
| `js/main.js` | 兩位玩家的開局、等待、素材網址 |
| `js/game.js` | 單一玩家的遊玩、彩蛋與成績 |
| `js/questions.js` | 顏色題與數學題 |
| `assets/animals/` | 預設動物圖 |
| `local_sqlite_server.py` | 本機開發用的 SQLite 成績後端（見下方） |

說明頁在 `Tutorial/DAT_double_tutorial.html`。

## 本地 SQLite 後端

`local_sqlite_server.py` 把成績寫進 `DAT_double/local_test.db`（已列入 `.gitignore`），不碰正式資料庫。只在本機開發時使用。

```bash
uv run --with fastapi --with uvicorn python DAT_double/local_sqlite_server.py
```

開啟 <http://127.0.0.1:5002/app/DAT_double/DAT_double.html>。頁面在 `/app/` 底下時，遊戲會把 API 指向同一個來源的 `/api`，所以成績會送到這台伺服器，而不是 5001 的開發後端。

- `POST /api/sessions` 寫入 SQLite；`GET /api/sessions` 列出已寫入的場次。`DAT_levelAccuracy` 這類逗號字串原樣保存。帶 `submissionId` 時和正式後端一樣冪等：同一位學生重送同一個 submissionId 回同一個 `sessionId`，不多寫一列；格式不是 UUID 回 422。
- 登入、`/api/auth/me` 等其他 `/api` 路徑轉送到開發後端（預設 `http://127.0.0.1:5001`），所以登入守門仍需要先照專案 README 啟動後端。連不上時回 502。
- `/app/` 只提供前端檔案（html、js、css、圖片、音效、json），不提供 `.db`、`.py`、隱藏檔，以及 `backend/`、`tests/`、`tools/`。
- `GET /health` 回傳 `{"status": "ok"}`。
- 環境變數：`DAT_LOCAL_PORT`（預設 5002）、`DAT_LOCAL_UPSTREAM`（預設 `http://127.0.0.1:5001`）、`DAT_LOCAL_DB`（資料庫路徑）。

測試：

```bash
uv run --with fastapi --with httpx --with pytest pytest tests/unit/test_dat_local_sqlite_server.py
```
