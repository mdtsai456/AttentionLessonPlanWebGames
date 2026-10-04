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

### 遊戲代號（10/04）
- 這個資料夾叫 `DAT`，但後端與後台把動物追擊令記為 `EFT`。
- 成績送 `lessonId: 1140908_EFT`，`stats[].apiname` 用 `EFT_*` 前綴，選單與後台顯示成「瓢蟲追擊令」。
- 素材 API 讀的是 `DAT.assets.files`，沿用資料夾命名。
- 漂浮泡泡（`EFT_*` 資料夾）剛好相反，送 `1140908_DAT` 與 `DAT_*`。兩邊都是正確的，不要改成跟資料夾同名。
