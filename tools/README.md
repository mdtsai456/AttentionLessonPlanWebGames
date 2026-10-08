# tools

給開發用的小工具，不是玩家會打開的頁面。

## build_manifest.py

讀 `DCCS_single/levels.json`，掃描 `DCCS_single/assets/`，寫出 `DCCS_single/manifest.json`。賽道攔截單人實際載入的是這份 manifest。

只處理單人那一份。`DCCS_double/` 有自己的關卡表與素材，這支程式不會改它。

在專案根目錄執行：

```bash
python tools/build_manifest.py
```

設定錯誤會直接停止。素材不夠的關卡會標成不可玩，並出現在 manifest 的 `warnings`。

## tgame-tests

勇闖迷宮的瀏覽器回歸。需要 Node.js 20 以上與已安裝的 Google Chrome。做法、篩選條件與它不會寫入正式成績的原因，見 [`tgame-tests/README.md`](tgame-tests/README.md)。

```bash
npm ci --prefix tools/tgame-tests
npm --prefix tools/tgame-tests test
```
