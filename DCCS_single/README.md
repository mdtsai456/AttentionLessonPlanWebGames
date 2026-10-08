# 賽道攔截・單人

第一人稱沿賽道前進。目標物由遠而近，玩家轉動兩道閥，在目標通過時用正中央的選項作答。選單名稱是「賽道攔截」，成績代號是 `DCCS`。

完整的閥門、判定與模組簽名見 [`SPEC.md`](SPEC.md)。只有這個遊戲有這份規格：引擎拆成多個模組，程式註解與測試照裡面的章節實作。瓢蟲追擊令、漂浮泡泡、勇闖迷宮、指令出擊的規則寫在各自的 README，不再另放 `SPEC.md`。

關卡數量以這個資料夾的 `levels.json` 為準。`SPEC.md` 前半的關卡表仍是較早的五關、每關 120 秒；現在的六關與每關 60 秒以 `levels.json` 和 `js/config.js` 為準。

## 現在的一局

`js/config.js` 的整場時間是 360 秒，依關卡數平分。`levels.json` 目前是 6 關，所以每關 60 秒。

每一題都同時有外框與內容，要連過兩道閥才算答對：

- 形狀閥只能往左，鍵是 `A` 或 `←`。選與目標外框相同的形狀。
- 物件閥只能往右，鍵是 `D` 或 `→`。`model` 選同一張圖，`category` 選同一個語意類別。

按一下轉一格。按住不連續轉，動畫中再按會排隊。答錯只記錄，遊戲繼續。兩道都對才加一分。

`levels.json` 現在的六關：

| 關 | 形狀數 | 物件數 | 物件規則 | 素材 |
| --- | --- | --- | --- | --- |
| 1 | 5 | 2 | 完全相同 | `assets/2/` |
| 2 | 5 | 3 | 完全相同 | `assets/3/` |
| 3 | 2 | 4 | 同一類別 | `2`、`3`、`4`、`5` 各一類 |
| 4 | 2 | 4 | 完全相同 | `assets/4/` |
| 5 | 2 | 5 | 完全相同 | `assets/5/` |
| 6 | 2 | 5 | 同一類別 | `2`、`3`、`4`、`5` 各一類 |

類別就是 `assets/` 底下的一個資料夾。形狀永遠來自 `assets/shape/`。

## 目錄

| 路徑 | 用途 |
| --- | --- |
| `index.html` | 單人頁。雙人登入會轉到 `DCCS_double/`。 |
| `js/main.js` | 讀 `Home/` 留下的學生資料並啟動一場。 |
| `js/dccs.js` | `mountDCCS()`，真正可被掛到頁面上的引擎。 |
| `js/config.js` | 時間、速度、閥門動畫等常數。 |
| `js/lobby.js` | 讀 session、結束後回選遊戲頁。 |
| `js/debugParams.js` | 開發用的場次秒數覆寫。 |
| `js/game/` | 出題、賽道、閥門、計分。 |
| `js/render/` | 道路、投影、分數。 |
| `js/net/` | 決定送成績的網址，以及失敗暫存。 |
| `js/core/`、`js/ui/` | 輸入、迴圈、素材與覆蓋層。 |
| `levels.json` | 人工維護的關卡表。 |
| `manifest.json` | 由關卡表與 `assets/` 產生，遊戲實際讀這份。 |
| `assets/` | 形狀與物件圖。產生 manifest 時只讀，不在遊戲裡改。 |
| `tests/` | 這個遊戲的單元與瀏覽器測試。 |

雙人不是執行時來載入這個資料夾。`DCCS_double/` 有自己的一份程式、關卡表與素材。

## 關卡清單

改 `levels.json` 或 `assets/` 之後，在專案根目錄執行：

```bash
python tools/build_manifest.py
```

這支程式只寫 `DCCS_single/manifest.json`。終端會印出每一關能不能出題；不可玩的關卡寫進 manifest 的 `warnings`。圖的 `src` 是相對 `DCCS_single/` 的路徑。

## 怎麼開始

正常流程是登入後從 `Tutorial/DCCS_tutorial.html` 進來。學生資料來自 `sessionStorage`，不放在網址上。缺年級、個案、場域或第幾天會回登入頁。

開發時可以加：

- `?seed=42`：固定亂數。
- `?sessionSeconds=5`：縮短整場秒數（5～3600）。縮短後仍會送成績，畫面上會有警告。

## 成績

預設 `lessonId` 是 `lesson_DCCS`，統計欄位前綴是 `DCCS_`。送出用 `POST /api/sessions`。

網址由 `js/net/apiBase.js` 決定，優先序是 `window.DCCS_SUBMIT_URL`、`window.API_BASE_URL`，最後才是目前頁面的 API 位址。送失敗的整包暫存在 `localStorage`，鍵名以 `dccs_pending_` 開頭，下次開啟遊戲時重送。伺服器永久拒絕的改存到 `dccs_rejected_`，不再重試。
