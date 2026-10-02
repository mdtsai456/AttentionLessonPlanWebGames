# 已知問題

## 「進入練習模式」按了沒反應，遊戲無法開始（2026-10-02）

- 現象：console 丟 `Cannot read properties of null (reading 'addEventListener')`。
- 原因：`5f7bf9e`（10/01 合併 `origin/dat_assets_api_angel`）把根目錄舊版
  `DAT_double/js/main.js`、`js/game.js` 整份蓋到這裡。結果：
  - `main.js` 綁定 `#leave-btn`，但本頁 HTML 沒有這顆按鈕，`getElementById`
    拿到 `null` 就丟錯。模組頂層丟錯，之後的程式（含 `initDoubleGameWorkflow()`）
    都沒執行。
  - 合併前這裡的 `main.js` 有綁定 `#start-practice-btn`（按下後隱藏
    `#tutorial-overlay`），合併後這段不見了。
  - 根目錄版 `main.js`／`game.js` 要搭配根目錄的 HTML 和 `../shared/*.js` 才能
    運作，本頁兩者都沒有。所以只補上面兩處，遊戲能開始，但會在後面卡住：
    - 練習結束後沒有 `#enter-formal-btn`，無法進正式關卡。
    - 正式關卡第 1 關結束時呼叫 `window.showStageClear`（根目錄
      `shared/stage-clear.js` 提供），本頁沒有載入，會丟錯並卡住。
    - 第 3 關結束等 `#mid-break` 面板，本頁沒有，會永遠停在等待。
    - 「回首頁」「離開」都導向 `../Select/index.html`，`frontend/` 底下沒有這頁（404）。
- 影響範圍：沒有頁面連到 `frontend/DAT_double/`，學生走的是根目錄
  `DAT_double/`，不受影響。
- 待決定：`frontend/DAT_double/` 要整份對齊根目錄版（HTML、CSS、`api.js`，
  以及 `shared/` 和 `Select/` 的路徑），還是退回合併前的版本，或是刪掉。

# 09.28 ~ 10.04 (README 更新時間: 9/30)
##  更新彩蛋與素材 api 
- 測試以 s070 做為有素材的範例（原本的圖片加上一些藍色標記）
### 修改動物圖片路徑
- 159~168 行
const ASSET_SERVER_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const DEFAULT_ANIMAL_PATH = 'assets/animals/rabbit.png';

// 預設彩蛋備用圖清單（無素材時輪播用）
const DEFAULT_ANIMAL_POOL = [
  'assets/animals/rabbit.png',
  'assets/animals/cat.png',
  'assets/animals/dog.png',
  'assets/animals/bird.png',
];
### 更改 DAT_double/js/main.js
- 158 行之後(function fetchStudentAssetList 附近)： assets 的 API 串接
### 學生 ID（10/01）
- 後端個案編號是 `S01` 這種格式。兩位玩家各自由 `assetStudentId()` 補成三位數再打素材 API，例如 `S01` → `S001`。
- 網址：`https://attention-lesson-plan-assets.zeabur.app/api/students/S001/assets`
- 目前同一個個案編號只對應一種場域，所以網址不含年級與場域。成績存檔仍用原本的 `caseId`。沒有客製圖的那位用預設圖。
### 更改 DAT_double/js/game.js
-  62~110 行(function setAnimalAssets 附近)：連續答對的彩蛋
### 修改一些 bug
- 修改會在每關最後一秒跑很多題目的問題
- 動物角色圖片完全載入才會顯示
- 改成換下一關不會重置動物圖片




# 之前版本的執行方式(現在用不到了)
## 目前寫在本地SQL lite 之後將api.js中
const API_BASE_URL = "http://127.0.0.1:5002";
改為 const API_BASE_URL = "https://attention-lesson-plan-transfer-data.zeabur.app";

cd frontend/DAT_double
python local_sqlite_server.py

cd "\backend"
uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

cd "\frontend"
python -m http.server 5500

## 開 http://127.0.0.1:5500/games.html

ctrl+F12 console
sessionStorage.setItem('game_mode', 'double');
sessionStorage.setItem('student1_key', 'G1_S03');
sessionStorage.setItem('student1_school', 'KMU');
sessionStorage.setItem('student2_key', 'G1_S04');
sessionStorage.setItem('student2_school', 'KMU');

## 重載入畫面至雙人即可藉由畫面跳轉至頁面5:Dat_double.html

在學姊的games.html
新增
   const GAME_PAGES = {
        5: "DAT_double\\DAT_double.html", // DAT 雙人版
      };
連接進去