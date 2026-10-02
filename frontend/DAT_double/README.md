# 已知問題

## 「進入練習模式」按了沒反應，遊戲無法開始（2026-10-02）

- 現象：開 `DAT_double.html`，說明畫面按「進入練習模式」沒有反應。console 有
  `Cannot read properties of null (reading 'addEventListener')`，位置在
  `js/main.js` 第 69 行。
- 原因：`5f7bf9e`（10/01 合併 `origin/dat_assets_api_angel`）把根目錄舊版
  `DAT_double/js/main.js` 整份蓋到這裡，兩份檔案現在完全一樣。結果：
  - 第 69 行綁定 `#leave-btn`，但本頁 HTML 沒有這顆按鈕，`getElementById`
    拿到 `null` 就丟錯。錯誤發生在模組最上層，後面的程式全部沒執行，包含最後的
    `initDoubleGameWorkflow()`（抓素材、`beginSession()`）。
  - 合併前這裡的 `main.js` 有綁定 `#start-practice-btn`（按下後隱藏
    `#tutorial-overlay`），合併後這段不見了。
- 修法方向：在 `main.js` 補回 `#start-practice-btn` 的綁定，`#leave-btn` 改成
  找不到就略過（或在 HTML 補上按鈕），再確認素材載入和開局流程正常。

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