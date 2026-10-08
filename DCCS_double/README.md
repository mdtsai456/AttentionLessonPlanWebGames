# 賽道攔截・雙人

同一台裝置上的兩個玩家各玩一場賽道攔截。選單名稱是「賽道攔截」，成績代號是 `DCCS`。

玩法與單人相同：目標物沿賽道由遠而近，形狀閥往左、物件閥往右，兩道都對才算答對。關卡表在這個資料夾的 `levels.json`，目前也是 6 關。機制細節見 [`../DCCS_single/SPEC.md`](../DCCS_single/SPEC.md)。

## 和單人的差別

這個資料夾有自己的 `index.html`、`js/`、`css/`、`levels.json`、`manifest.json` 與 `assets/`。改雙人關卡或圖時改這裡，不要只改 `DCCS_single/`。

`tools/build_manifest.py` 只產生單人的 `manifest.json`。雙人的清單要另行維護。

操作：

| 玩家 | 形狀閥（左） | 物件閥（右） |
| --- | --- | --- |
| 玩家 1 | `A` | `D` |
| 玩家 2 | `←` | `→` |

兩人各送一筆成績，`mode` 為 `double`，並帶同一組搭檔 token。暫存鍵名同樣是 `dccs_pending_`，規則與單人相同，見 [`../DCCS_single/README.md`](../DCCS_single/README.md)。

## 怎麼開始

從 `Tutorial/DCCS_double_tutorial.html` 進入 `index.html`。頁面要求雙人登入。缺任一位學生資料時不會開局。
