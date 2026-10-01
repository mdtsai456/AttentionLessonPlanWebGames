# 09.28 ~ 10.04 (README 更新時間: 9/30)
##  更新彩蛋與素材 api 
- 測試以 s070 做為有素材的範例（原本的圖片加上一些藍色標記）
### 修改動物圖片路徑
- 651~658 行：
const ASSET_SERVER_HOST = 'https://attention-lesson-plan-assets.zeabur.app';
const DEFAULT_ANIMAL_PATH = 'assets/animals/rabbit.png';
const DEFAULT_ANIMAL_POOL = [
  'assets/animals/rabbit.png',
  'assets/animals/cat.png',
  'assets/animals/dog.png',
  'assets/animals/bird.png',
];
### 更改 DAT_single/DAT_single.js
- 241~337行(function updateAnimalImage 附近)：連續答對更換動物角色彩蛋
- 650 行開始(function fetchStudentAssets)：assets 的 API 串接
### 學生 ID（10/01）
- 後端 `caseId` 是 `S01` 這種格式。打素材 API 前由 `assetStudentId()` 補成三位數，例如 `S01` → `S001`。
- 網址：`https://attention-lesson-plan-assets.zeabur.app/api/students/S001/assets`
- 目前同一個個案編號只對應一種場域，所以網址不含年級與場域。成績存檔仍用原本的 `caseId`。
### 修改一些 bug
- 修改會在每關最後一秒跑很多題目的問題
- 動物角色圖片完全載入才會顯示




# 檔案用途
- DAT_single.：遊戲畫面
- DAT_tutorial.：遊戲說明
- 