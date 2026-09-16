# AttentionLessonPlanTransferDataPlatform

注意力教案的遊戲資料中介 API。以 FastAPI 讀寫 MariaDB，接收 Unity 遊戲結果並供前端與研究用途查詢。

## 端點

完整清單（含帳密登入、驗證規則、錯誤碼）見 **[`docs/backend-reference.md`](docs/backend-reference.md)**——
一站式的 API + 資料庫結構總覽。這裡只列最常用的幾支：

| 方法 | 路徑 | 驗證 | 說明 |
|---|---|---|---|
| GET | `/health` | 公開 | 存活檢查 |
| POST | `/api/sessions` | 無（Unity） | 接收 Unity GameData，成功後回傳 `sessionId` |
| POST | `/api/auth/teacher/login` / `/api/auth/student/login` | 公開 | 帳密登入，回 `token`（見 `docs/adr/0004`） |
| GET | `/api/me/students` | 老師 | 登入中老師名下的學生概況 |
| GET | `/api/students/{studentKey}/report` | 老師或學生 | ★主要端點：場次明細＋各遊戲彙總＋趨勢 |

`studentKey` 的格式是 `grade_caseId`，例如 `G1_S03`。學生的唯一鍵是
`(grade, case_id, school)` —— 不同場域的 `G1_S03` 是不同的學生。

### 單人版／雙人版（mode）

DAT／DCCS／EFT 有「單人版」與「雙人版」（一台裝置兩個小孩），DAT/DCCS/EFT 以外
永遠是 `single`。`assessment_result.mode` 記模式、`pair_id` 記同一雙人局的兩筆連結
（由 Unity 產生，後端只存）。`/report` 與 `/sessions` 每筆回應帶 `mode`；
`summaryByGame`／`trends` 依 `(gameType, mode)` 分組（`single` 排在 `double` 前）。
設計見 [`docs/superpowers/specs/2026-09-08-single-vs-double-player-mode-design.md`](docs/superpowers/specs/2026-09-08-single-vs-double-player-mode-design.md)。

### 帳密登入 / 參照資料

老師與學生都要帳號＋密碼登入（2026-09-11 廠商改口，取代原本的選單式免密碼），
且老師只能查看自己場域的學生（後端強制擋，不只前端 UI 藏）。帳號是後端另外指派
的全域唯一字串（`T0001`／`S0001` 格式），不是老師姓名或 `studentKey`。完整規格見
[`docs/backend-reference.md`](docs/backend-reference.md) §1.2、決策脈絡見
[ADR-0004](docs/adr/0004-teacher-student-password-login.md)。

`school`、`teacher` 兩張表是**由人工維護、量少、變動極慢**的參照資料，用
`seed_directory.py` 冪等灌注（不像 `seed.py` 是「先清空再灌的假成績」），順便
幫還沒帳號的老師指派 `account` + 密碼並印出一次：

```bash
uv run python seed_directory.py          # → TEST_DB_NAME 的 _test 庫
DB_USER=root DB_PASSWORD='<root密碼>' uv run python seed_directory.py --prod
```

單一老師/學生要重設密碼用 `manage_passwords.py`（見 `docs/backend-reference.md` §3.4）。

8 個場域字串（`school` 表主鍵）目前是**佔位代碼**（`KMU`、`NTHU-01`…），待廠商
確認正式字串後只改 `seed_directory.py` 的常數、重跑即可。設計見
[`docs/superpowers/specs/2026-09-08-teacher-directory-login-design.md`](docs/superpowers/specs/2026-09-08-teacher-directory-login-design.md)
（**注意**：該文件的「無密碼」章節已被 ADR-0004 推翻，場域字串定案等其餘內容仍有效）。

## 開發

**需要 Python 3.10 以上。** 程式碼使用 `X | None` 型別註記，Pydantic 在 3.9 上無法解析它。

環境以 [`uv`](https://docs.astral.sh/uv/) 管理，版本鎖在 `uv.lock`（進版控，CI 與本機一致）。

```bash
# 安裝 uv（見官方文件；或 pipx install uv）
cp .env.example .env        # 填入 DB_PASSWORD / DB_WRITE_PASSWORD / TEST_DB_NAME
uv sync --group dev         # 依 uv.lock 建 .venv 並裝好相依套件
uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001
```

Windows PowerShell 相同，指令逐字照打即可。互動式文件在
<http://127.0.0.1:5001/docs>。

`requirements.txt` / `requirements-dev.txt` 是 `uv export` 的產物，僅供不吃
`pyproject.toml` 的部署流程（如現行 Zeabur）使用，**不要手改**；改相依請改
`pyproject.toml` 後 `uv lock` 再重新 export。

## 測試

測試需要一個名稱以 `_test` 結尾的資料庫。`tests/conftest.py` 會拒絕在
其他資料庫上執行，以免清空正式資料。

```bash
uv run pytest -q
```

**不要並行執行測試。** 所有測試共用同一個測試資料庫，每個測試前後都會清空它。

未設定 `TEST_DB_NAME` 時，需要資料庫的測試會被跳過，純函式測試照常執行。

## 假資料（seed）

`seed.py` 灌一批可重現的假資料，供本機開發／demo 肉眼看 API（3 校 × 6 生 ×
5 遊戲 × 2 梯次，2,160 場單人版 + 324 場 DAT/DCCS/EFT 雙人版，含撐起 trends 折線
的進步趨勢）。先清空再灌、固定亂數種子，重跑結果一致。設計見
[`docs/superpowers/plans/2026-07-10-seed-mock-data.md`](docs/superpowers/plans/2026-07-10-seed-mock-data.md)。

```bash
uv run python seed.py          # 預設 → 灌 TEST_DB_NAME 的 _test 庫（需名字結尾 _test）
```

`--prod` 才會改灌正式庫（先清空再灌），且正式庫走 root 閘門（`seeder` 帳號無正式庫權限）：

```bash
DB_USER=root DB_PASSWORD='<root密碼>' uv run python seed.py --prod
```

**注意：一旦正式庫存有真實受試者資料，`--prod`（先清空再灌）會刪掉真資料，應停用。**

## 資料庫帳號與權限

依最小權限拆分帳號，不再到處用 root（決策與取捨見
[ADR-0001](docs/adr/0001-least-privilege-db-accounts.md)）：

| 帳號 | 權限 | 綁定庫 | 用途 |
|---|---|---|---|
| `app_ro` | `SELECT` | 正式庫 | 部署（Zeabur）的讀取 API。`.env`／Zeabur 環境變數設它 |
| `game_writer` | `INSERT`（7 張寫入表） | 正式庫 | 部署（Zeabur）的 `POST /api/sessions` |
| `seeder` | `SELECT, INSERT, DELETE, CREATE` | **只** `_test` | 本機 `seed.py`（預設）與測試套件 |
| `root` | 全權 | 全域 | 只人工維運；正式庫灌注走它 |

- 線上 GET 使用 `DB_USER=app_ro`；POST 使用
  `DB_WRITE_USER=game_writer`。兩組密碼分開設定。
- 本機與測試庫可將 read/write credentials 都指向 `seeder`；正式庫不可使用
  `seeder`。
- App 啟動時會檢查 `DB_USER`、`DB_PASSWORD`、`DB_WRITE_USER`、
  `DB_WRITE_PASSWORD`，缺少或空白就拒絕啟動。
- host 目前皆 `'@%'`；取得固定對外 IP 後再收緊。
- 密碼須在上線前輪換，各帳號各自一組。

## 模組

完整清單（含每個 router 掛哪些端點）見
[`docs/backend-reference.md`](docs/backend-reference.md) §3.1。

| 檔案 | 職責 |
|---|---|
| `main.py` | 建立 app、掛載 router、CORS、`/` 與 `/health` |
| `db.py` | MariaDB 連線設定 |
| `auth.py` | 密碼雜湊、登入 token 產生（純函式） |
| `errors.py` | 共用的資料庫錯誤轉換（避免 router 間循環匯入） |
| `converters.py` | 純轉換工具 |
| `models.py` | Pydantic 回應模型 |
| `queries.py` | 讀取資料的 SQL |
| `writes.py` | 以單一 transaction 建立學生、場次、遊戲結果、登入 token |
| `routers/sessions.py` | 接收 Unity GameData 的 `/api/sessions`、`/api/games` |
| `routers/students.py` | `/api/students`、`/sessions`、`/report` 路由與組裝邏輯 |
| `routers/directory.py` | `/api/schools`、`/api/me/students`、`/api/teachers/...` |
| `routers/auth.py` | 登入／登出端點 |
| `routers/identity.py` | token 驗證與授權檢查（`Depends`） |
| `seed.py` | 灌假資料到 `_test`（`--prod` 才碰正式庫）。獨立 dev 工具 |
| `seed_directory.py` | 冪等灌注 `school`／`teacher` 參照資料 + 指派帳密。獨立工具 |
| `manage_passwords.py` | 手動重設單一老師/學生密碼的 CLI |
