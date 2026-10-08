# 瓢蟲追擊令・雙人

左右各一位玩家，規則與單人相同。選單、資料夾與成績代號都是 `DAT`。單人的題型、秒數與動物升級見 [`../DAT_single/README.md`](../DAT_single/README.md)。

## 和單人的差別

| 玩家 | 移動 | 作答 |
| --- | --- | --- |
| 玩家 1（左） | `W` `A` `S` `D` | 空白鍵 |
| 玩家 2（右） | 方向鍵 | Enter |

兩人各自出題、計分、連擊與動物圖。換關不重置已經升過的動物。

練習是 `?mode=practice`，每人 2 題，顏色與數學各一題。正式是 `?mode=game`，6 關、每關 60 秒，顏色與數學每題隨機。

第 3 關結束要等兩人都到，才一起選繼續或回大廳。成績各送一筆，`lessonId` 為 `1140908_DAT`，`mode` 為 `double`，並共用一組 `pairId`。

## 動物圖

兩人各打一次素材平台，圖的順序來自：

`https://attention-lesson-plan-assets.zeabur.app/api/students/{學生ID}/assets`

玩家 1 用 `student1_case`，玩家 2 用 `student2_case`。個案編號補成三位數，例如 `S01` 打成 `S001`。網址不含年級與場域。回應由 `shared/dat-assets.js` 的 `fetchAssetList` 讀 `DAT.assets.files`。沒有客製圖、請求失敗，或只有一張時，那位玩家用 `assets/animals/` 的兔子、貓、狗、鳥補上。圖片要載入完成才換上去。

成績裡的 `caseId` 仍用原本的編號，不補成三位數。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `DAT_double.html` | 雙人畫面 |
| `js/main.js` | 兩位玩家的開局、等待、素材網址 |
| `js/game.js` | 單一玩家的遊玩、彩蛋與成績 |
| `js/questions.js` | 顏色題與數學題 |
| `js/api.js` | 雙人這局的編號 |
| `assets/animals/` | 預設動物圖 |

說明頁在 `Tutorial/DAT_double_tutorial.html`。
