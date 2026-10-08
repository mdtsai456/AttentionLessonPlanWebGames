# 漂浮泡泡・雙人

左右各一位玩家。記泡泡、看箭頭、計分與升級規則和單人相同，見 [`../EFT_single/README.md`](../EFT_single/README.md)。

## 和單人的差別

兩人各有一個 `shared/eft-player.js` 的玩家，連擊、箭頭階數與素材互不影響。素材用各自的個案編號向平台要 `EFT.assets.files`。同一個學生編號可以共用一次請求。

| 玩家 | 按鍵 |
| --- | --- |
| 玩家 1（左） | `A` 向左、`D` 向右 |
| 玩家 2（右） | `←` 向左、`→` 向右 |

每一關 60 秒、共 6 關，單題 10 秒沒答算錯。某人打完一關後會等另一位；第 3 關結束同樣先等齊，再一起離開中場。六關都完成才結束。

按「離開」時，若兩人都至少打完第 3 關，會各送一筆到該檢查點。六關完成也會各送一筆。`lessonId` 為 `1140908_EFT`，`mode` 為 `double`，並帶同一組 `pairId`。中場畫面上的返回按鈕直接回到選遊戲頁，不在那個按鈕裡送成績。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `EFT_double.html` | 雙人畫面 |
| `EFT_double.js` | 建立兩個玩家、等待過關、分別送成績 |
| `EFT_double.css` | 版面 |
| `assets/arrow/` | 這頁用的預設泡泡與箭頭 |
| `fonts/` | 字型 |

說明頁在 `Tutorial/EFT_double_tutorial.html`。出題與預載不在這個資料夾，而在 `shared/eft-game-logic.js`、`shared/eft-player.js`、`shared/eft-assets.js`。
