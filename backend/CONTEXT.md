# Context — 詞彙表

本檔是領域詞彙表,只放術語定義,不放實作細節。

## 核心術語

- **Student(學生)** — 唯一鍵是 `(grade, case_id, school)`。同一個 `grade_caseId`(例如 `G1_S03`)在不同 `school` 是**不同的學生**。
- **School(場域)** — 學生所屬的施測場域,是學生身分的一部分,不只是屬性。`school` 表把「散落在資料裡的 school 字串」正規化成一份清單(識別字串 + 顯示名稱),是這份字串的唯一真實來源。
- **Teacher(老師)** — 隸屬於**單一**場域。同場域的老師看得到該場域的**所有**學生(廠商定調,不做老師↔學生對應表)。無密碼欄位:登入=下拉選人。
- **參照資料(reference data)** — `school`、`teacher` 這種「由人工維護、量少、變動極慢」的資料。用 `seed_directory.py`「冪等補齊、絕不清空」;相對於 `seed.py` 灌的「假成績」是「先清空再灌」。
- **Session(場次)** — 一位學生某天玩某一個遊戲的一次紀錄,對應 `assessment_result` 一列,唯一鍵 `(grade, case_id, school, uuid)`。帶 `start_time`、`end_time`、`current_day`、`game_type`。
- **game_type(遊戲類型)** — 一場 Session 玩的是哪一個遊戲,取值為以下五種之一。
- **mode(模式)** — 一場 Session 是 `single`(單人版)或 `double`(雙人版)。存在 `assessment_result.mode`,預設 `single`;既有所有資料視為 `single`。只有 DAT/DCCS/EFT 有雙人版。
- **pair(雙人局)** — 一台裝置上兩個小孩一起玩的一場雙人遊戲,產生**兩筆** Session(各一位學生),兩筆共用同一個 **`pair_id`**(UUID 字串,由 Unity 開局時產生,後端只存不生;`single` 時為 `NULL`)。
- **五款遊戲** — 每一款在專屬明細表有一列,以 `(grade, case_id, school, uuid)` 外鍵掛在 Session 底下:
  - **DCCS** → `dccs_result`
  - **DAT** → `dat_result`
  - **EFT** → `eft_result`
  - **IM** → `im_result`
  - **TGame** → `tgame_result`

## 施測設計術語(mock data 用)

- **Round(梯次)** — 一段連續 4 週、每週 3 個施測日的施測期,共 12 個施測日。整個研究有兩個 Round:**Round A**(注意力教案介入前的基線)與 **Round B**(介入後)。B 在 A 結束後**隔約一個月**才開始,那個月是教學介入期。設計意圖:Round B 整體表現優於 Round A(有些指標進步、有些持平、有些略退,但整體淨進步)。資料庫沒有 round 欄位,梯次只由 `start_time` 的日期落點區分。
- **施測日** — 一位學生某一天的整套施測,固定約 30 分鐘:5 款遊戲一款接一款各玩約 6 分鐘。同一施測日的 5 場 Session 共用同一個 `current_day` 值。

## 環境術語

- **正式庫(production)** — `AttentionLessonPlan`,遠端 MariaDB。**現況(2026-07-10 查證):裡面只有 5 筆佔位測試資料(校名「測試場域」),沒有真實研究資料**,團隊視其為可拋棄。因此 mock data 可經 `seed.py --prod` 灌入(先清空再灌)。日後若真的裝進真實研究資料,此決定需重新檢視——屆時假資料應改帶可撿回的標記,勿與真資料混灌。
- **測試庫(test DB)** — `AttentionLessonPlan_test`,名稱以 `_test` 結尾。測試套件每次跑會清空它;`tests/conftest.py` 拒絕在非 `_test` 庫上執行。

## 存取帳號(最小權限,見 [ADR-0001](docs/adr/0001-least-privilege-db-accounts.md))

- **`app_ro`** — 只 `SELECT`,綁正式庫。部署在 Zeabur 的 GET API 用它。
- **`seeder`** — `SELECT/INSERT/DELETE/CREATE`,**只**綁測試庫 `_test`。`seed.py`(預設)與測試套件用它。刻意不給正式庫,擋掉「測試帳號毀掉真資料」。
- **`root`** — 全權,只留人工維運;正式庫的灌注(`seed.py --prod`)走它。
- **`game_writer`** — Unity 遊戲結果經 POST API 寫回正式庫的 INSERT-only 帳號。只對 Student、Session 與五張遊戲結果表授予 `INSERT`;DB 帳密只放伺服器端,不上受試者機器。
