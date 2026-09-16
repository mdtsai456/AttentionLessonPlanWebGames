# seed.py — 灌 mock data 計畫

日期:2026-07-10

## 目的

正式庫 `AttentionLessonPlan` 有真資料但太稀疏,本機開發/demo 時三個端點
(`/api/students` 名單、`/report` 明細+彙總、`/report` 的 trends 折線)看起來空。
需要一支腳本一鍵灌出「飽滿又合理」的假資料,肉眼驗證 API。

## 硬約束(安全)

- 假資料**只**進 `TEST_DB_NAME` 指的 `_test` 庫。正式庫 `AttentionLessonPlan`
  永遠保持乾淨。
- `seed.py` 沿用 `conftest` 那道「名字必須以 `_test` 結尾否則拒跑」的檢查,
  **絕不讀 `DB_NAME`**(那個指向正式庫)。
- DB 密碼只從 `.env` 讀,不寫進任何檔案或 commit。

## 形式

- 獨立腳本 `seed.py`(repo 根),`.venv/bin/python seed.py` 執行。
- 重用 `db.get_connection()` 與現有 INSERT 形狀(參考 `conftest.DbHelper`)。
- **先清空再灌**(child-first DELETE,重用 `_test` 守衛),重跑結果一致。
- 批次 insert(`executemany`),約 4,340 筆一次灌完。
- **固定亂數種子** `random.seed(20260710)` → 完全可重現。

## 資料形狀

**3 場域 × 6 學生 × 5 遊戲 × (每週 3 天 × 4 週) × 2 Round = 2,160 場**

- 場域:`陽光國小`、`西門國小`、`民富國小`
- 每校 6 位學生:`G1_S01`、`G1_S02`、`G1_S03`、`G2_S04`、`G2_S05`、`G2_S06`
  (學生主鍵 `(grade, case_id, school)`;case_id 跨校重用沒問題)
- 五款遊戲的 `game_type` **必須精確對上** `queries.GAME_RESULT_TABLES` 的鍵:
  `DCCS`、`DAT`、`EFT`、`IM`、**`TGAME`(全大寫)**。寫錯 report 會查不到 stats。

### 日曆(固定錨點)

- **Round A**:2026-01-05(週一)起,連續 4 週,每週一/三/五 → 12 個施測日,
  至 2026-01-30。(介入前基線)
- 隔約一個月(教學介入期)。
- **Round B**:2026-03-02(週一)起,同樣 4 週一/三/五 → 12 個施測日,
  至 2026-03-27。(介入後)
- 每學生每 Round 12 施測日 × 2 Round = 24 天;每天玩 5 款 → 120 場/人。

### 每個施測日的時間軸(每天約 30 分鐘)

- 12:00 開始,5 款固定順序 `DCCS → DAT → EFT → IM → TGAME`。
- 每款約 6 分鐘,款與款之間 0–2 分鐘隨機小空檔 → 整套約 12:30–12:40 結束,
  穩定落在 13:00 前。
- `start_time` / `end_time` 依序推算;`end_time` 全部填(無未完成場次)。
- `current_day`:整個研究的施測日序號 **1…24**(Round A 為 1–12、Round B 為
  13–24);同一天的 5 場共用同一個值。

## 數值模型(只填核心 5 欄)

API 只讀 `correct_count, wrong_count, accuracy, duration, stage`。其餘遊戲專屬
欄位**一律 NULL**(可空、無端點會讀)。

- `accuracy` 是 **0–1 的分數**(非百分比)。
- 每個(學生 × 遊戲)配一條軌跡:
  - Round A 基線 `a0` ~ 隨機 **0.45–0.70**。
  - 軌跡標籤:**進步 60% / 持平 25% / 略退 15%**(整體淨進步 ≈ +0.08)。
    - 進步 → Round B 均值 `a0 + (0.08–0.20)`,上限 0.98。
    - 持平 → `a0 ± 0.02`。
    - 略退 → `a0 − (0.02–0.06)`,下限 0.30。
  - Round 內 12 天有微升趨勢 + 每場 ±0.03 雜訊,clamp 至 [0.02, 0.99]。
- 由 accuracy 反推、保持一致:
  - `stage`(總作答數)~ 隨機 **15–40**。
  - `correct = round(accuracy × stage)`;`wrong = stage − correct`;
    `accuracy` 再由 `correct / stage` 回算(完全一致)。
- `duration` ≈ 360000 ms ± 抖動。

## 驗證

灌完後把 uvicorn 的 `.env` `DB_NAME` 指到 `_test` 庫,打:
- `GET /api/students`(應見 18 位、跨三場域)
- `GET /api/students/G1_S01/report?school=陽光國小`(records 滿、summaryByGame
  五款、trends 每款 24 點且 Round B 多半高於 Round A)

## 不在範圍內

- 填遊戲專屬明細欄位。
- 零場次學生 / 未完成場次(交給 student-list 的邊界測試,不靠 demo 資料湊)。
- 為 `seed.py` 寫 pytest。

## 增修(2026-07-10):也灌正式庫

原決定「假資料只進 `_test`、正式庫永遠乾淨」已翻案。查證後正式庫
`AttentionLessonPlan` 裡只有 5 筆佔位測試資料(校名「測試場域」),無真實研究
資料,團隊同意可清空。

- 新增 `--prod` opt-in:`.venv/bin/python seed.py --prod` 會改灌正式庫,
  一樣「先清空再灌」。**不加 `--prod` 時預設仍只灌 `_test`,且強制名字須以
  `_test` 結尾** —— 正式庫不會被手滑波及。
- 已執行:正式庫現含 18 學生 / 2,160 場,舊「測試場域」資料清零。
- 移除舊的「進正式庫需加可撿回 MOCK 標記」限制。但假資料仍用一眼可辨的三個
  假校名(陽光/西門/民富),若日後正式庫要裝真資料,可據此 `WHERE school IN
  (...)` 清除(注意 `assessment_result` 對 `student` 只有 ON UPDATE CASCADE,
  刪除要由子表往父表:先刪 `assessment_result`(連帶明細表 ON DELETE CASCADE)
  再刪 `student`)。
