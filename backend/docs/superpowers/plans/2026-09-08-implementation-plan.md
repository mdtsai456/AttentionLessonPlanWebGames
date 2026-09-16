# 實作總覽：登入／場域／老師 + 單／雙人模式

日期：2026-09-08

這份文件是**冷啟動入口**。若你（或另一個 Claude Code 視窗）在沒有先前對話脈絡的
情況下要動工，從這裡開始讀。

## 這次要做兩件事

| 代號 | 功能 | 設計文件 |
|---|---|---|
| **A** | `assessment_result` 加 `mode`／`pair_id`；`POST /api/sessions` 與 `GET .../report`、`.../sessions` 支援單／雙人版 | [`specs/2026-09-08-single-vs-double-player-mode-design.md`](../specs/2026-09-08-single-vs-double-player-mode-design.md) |
| **B** | 新增 `school`、`teacher` 表與 3 支唯讀端點，做「場域→老師→學生→進度」的選單式登入 | [`specs/2026-09-08-teacher-directory-login-design.md`](../specs/2026-09-08-teacher-directory-login-design.md) |

**A 與 B 互不阻塞**，可任一順序或平行做。兩份 spec 各自有完整的 API 契約、SQL、
模組清單、測試清單與實作步驟 —— 那些不在這裡重複，這裡只給冷啟動需要的環境、
順序與維運資訊。

### 這次不做

- 前端（另一位組員負責，vanilla JS + Canvas）。
- 真正的身分驗證（廠商定調：下拉選人，無密碼）。
- 老師↔學生對應表（廠商定調：同場域兩位老師管全部學生）。
- IM／TGame 的雙人版（廠商只要 DAT/DCCS/EFT）。
- 改用 `uv`（見 spec B 附錄 A；獨立工作項目，建議先做，因為順帶修掉測試相依問題）。

## 廠商已定調（不需再確認）

- 雙人版：**一台裝置兩個小孩**。每位學生各記一筆成績。Unity 開局產一個
  `pairId`（UUID），兩位學生的 POST 都帶同一個。
- 雙人版成績欄位與單人版**完全相同**，無合作／對戰新指標 → 結果寫進既有的
  `dat_result`／`dccs_result`／`eft_result`，這五張表**不動**。
- 報告頁：單雙人同頁呈現但要分得出來 → `records`/`summaryByGame`/`trends` 每筆帶
  `mode`，後兩者依 `(gameType, mode)` 分組。
- 老師 16 位（吳老師、林老師⋯），每場域 2 位，**直接在資料庫手動建**（用
  `seed_directory.py`）。

## 仍待廠商提供（不擋開工）

- **8 個場域的實際字串**（高醫 ×1、清大 ×7）。`school` 這個字串是 `student`、
  `assessment_result`、五張結果表的 join key，也是 Unity POST 的 `data.school`，
  三方必須一致。定案前 `seed_directory.py` 先用佔位代碼（`KMU`、`NTHU-01`…
  `NTHU-07`），程式全部照結構做完，字串定案後只改常數重跑腳本。
- `single` 這個分支命名字尾的確切含義（推測是「單人模式」，與 `double` 對應）。

---

## 需要跟團隊要的資訊

專案是以 zip 形式取得的，`.env` 裡的密碼欄位被清空（正常做法：密碼不隨程式碼發佈，
見 [ADR-0001](../adr/0001-least-privilege-db-accounts.md)「密碼⋯該字串已外流」）。
下列資訊需分別向對應的人索取。**密碼一律只寫進本機 `.env`（已在 `.gitignore`），
不進版控、不貼聊天室、不寫進程式碼。**

### A. 向資料庫管理者索取（帳號密碼）

| 項目 | 用途 | 優先 |
|---|---|---|
| `seeder` 帳號的**帳號 + 密碼** | 跑測試、跑 `seed.py`／`seed_directory.py` | 🔴 擋開工 |
| 確認測試庫 `AttentionLessonPlan_test` **已存在且可外部連線**（名稱須以 `_test` 結尾） | 跑測試的前提；不存在需請有 root 者建立或給 `CREATE` 權限 | 🔴 擋開工 |
| `app_ro` 帳號的密碼 | `.env` 的 `DB_PASSWORD`，線上 GET | 🟡 正式串接前 |
| `game_writer` 帳號的密碼 | `.env` 的 `DB_WRITE_PASSWORD`，POST 寫入 | 🟡 正式串接前 |
| 確認對外連線位址與埠（現記載 `43.163.233.40:31913`）、`DB_NAME`（`AttentionLessonPlan`）是否仍正確 | | 🟡 |

**為什麼 `app_ro`／`game_writer` 不夠跑測試**：依 ADR-0001，`app_ro` 只有 `SELECT`、
`game_writer` 只有特定表的 `INSERT`。測試要 `CREATE TABLE`／`DELETE`／`INSERT` 到
測試庫，只有 `seeder`（`SELECT/INSERT/DELETE/CREATE`，只綁 `_test`）做得到。
**先確認 `seeder` 帳號是否已建立** —— ADR 只記錄了決策，「後續實施」僅確認
`game_writer` 已建；`seeder` 若尚未建立，須請管理者依 ADR-0001 建立。

跑測試時的 `.env` 設法（read/write 都指向 `seeder`）：

```ini
DB_HOST=43.163.233.40
DB_PORT=31913
DB_USER=seeder
DB_PASSWORD=<seeder 密碼>
DB_WRITE_USER=seeder
DB_WRITE_PASSWORD=<seeder 密碼>
DB_NAME=AttentionLessonPlan
TEST_DB_NAME=AttentionLessonPlan_test
```

<details>
<summary>可貼給主管的訊息（請他轉請資料庫管理者）</summary>

> 我要開始開發中介平台的後端功能，需要以下資訊設定開發與測試環境：
> 1. `app_ro` 帳號的密碼（唯讀，線上查詢 API 用）
> 2. `game_writer` 帳號的密碼（Unity 遊戲結果寫入用）
> 3. `seeder` 帳號的帳號與密碼（跑測試與灌假資料用）。依 ADR-0001 只綁測試庫、
>    具 SELECT/INSERT/DELETE/CREATE；若尚未建立，煩請依 ADR-0001 建立
> 4. 確認測試資料庫 `AttentionLessonPlan_test` 已存在且可從外部連線；若不存在煩請協助建立
> 5. 確認目前對外的 DB 連線位址與埠號（現有文件記載為 `43.163.233.40:31913`）是否仍正確
>
> 第 3、4 項是開始跑測試的必要條件，會優先需要；第 1、2 項可在正式串接前提供即可。

</details>

### B. 向廠商索取（決策與內容，擋上線不擋開工）

| 項目 | 卡住什麼 |
|---|---|
| **8 個場域的正式字串**（高醫 ×1、清大 ×7 各自的識別字串） | 灌 `school`／`teacher` 表；也是 Unity POST 的 `school` 值，三方須一致 |
| **16 位老師名單**（每場域哪 2 位、顯示名稱如「吳老師」） | 灌 `teacher` 表 |
| **正式庫結構變更由誰、如何執行**（`ALTER TABLE`／`CREATE TABLE`／`GRANT`） | 依 ADR 走 root：是取得 root 密碼自行執行，還是提供 SQL 給有 root 者代跑 |
| 是否需要 **Zeabur 專案存取權** | 正式庫改完後確認／重部署／查環境變數 |
| `single`／`double` 分支字尾的確切含義 | 分支命名對齊（小事） |

### C. 與 Unity 組員對接（功能 A 契約）

| 項目 | 說明 |
|---|---|
| 確認雙人版 POST 會加 `data.mode`（`"double"`）與 `data.pairId`（UUID），欄位名與位置照 [spec A](../specs/2026-09-08-single-vs-double-player-mode-design.md) | |
| 各場域 Unity build 送的 `school` 字串 = B 的場域字串，須完全一致 | |
| 雙人版 `lessonId` 維持現格式（`xxx_DAT` → 取最後 `_` 後段判斷遊戲） | |
| 雙人版 Unity build 預計上線時間 | 決定正式庫 `ALTER TABLE assessment_result` 的截止時間 |

### D. 與前端組員對接

- 兩份 spec 給對方（API 契約在內）。
- 提醒：PDF 第 4 頁「五個遊戲平均表現比較」圖之後最多 8 條（5 單人 + 3 雙人）。
- 講定登入頁的 repo／分支歸屬。

### E. 專案本身：取得正式 git repo

手上的 zip **不是 git repo**，但專案有 ADR／specs／plans、分支命名規則
`login_single_<yourname>` —— 團隊必有一個正式 repo（可能在 GitHub）。**向團隊索取該
repo 的存取權，`git clone` 正式版來做**，不要在 zip 上改（否則無歷史、無法發 PR）。
本目錄下 `docs/superpowers/` 的三份文件屆時 `git add` 進去即可。

---

## 開始前：環境

> 本專案的開發環境曾在 2026-09-08 的一個 Claude Code 視窗裡架好過一次（Windows）。
> 若你在**同一台機器**接手，`.venv/` 可能已存在；若是新 clone 或別台機器，照下面
> 重建。

### 平台與 Python

- 開發機為 **Windows 11 + PowerShell**。專案原本的 `README.md` 是 macOS/brew 寫法，
  指令要換成 Windows。
- **需要 Python 3.10 以上**（程式用 `X | None` 型別語法，Pydantic 在 3.9 解析不了）。
  開發機上 `py -3.12` 為 3.12.10，可用。
- Zeabur 上的部署環境 Python 為 3.10+，`Procfile` 是 `uvicorn main:app`。

### 建 venv 與裝套件（若 `.venv/` 不存在）

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
```

**⚠️ 相依性坑（未鎖版本造成）**：`requirements*.txt` 沒鎖版本，`pip` 會抓到最新的
`starlette` / `anyio`。新版 `anyio` 對 `anyio.abc.BlockingPortal` 發 `DeprecationWarning`，
而 `pytest.ini` 設了 `filterwarnings = error`，於是 `pytest` 連測試都**收集不起來**
（`tests/test_api.py`、`tests/test_sessions.py` 等在 import `TestClient` 時就炸）。

暫時解法（開發機上已套用）：

```powershell
.\.venv\Scripts\python.exe -m pip install "anyio<4.10"
```

**正解**：做 spec B 附錄 A 的 `uv` 遷移，產生 `uv.lock` 把版本鎖死。建議在動 A/B
之前先做這一步。

### `.env`

```powershell
Copy-Item .env.example .env
```

然後填入**真實密碼**（向團隊要）：

- `DB_PASSWORD` —— `app_ro` 的密碼（GET 用）
- `DB_WRITE_PASSWORD` —— `game_writer` 的密碼（POST 用）
- `TEST_DB_NAME` —— 測試庫名稱，**必須以 `_test` 結尾**（`.env.example` 已有
  `AttentionLessonPlan_test`）

App 啟動時只檢查這四個變數非空，不連線。所以填佔位字串也能啟動、`/health` 會回
`ok`，但 `/api/*` 查資料的端點會失敗。

### 測試資料庫

`tests/conftest.py` 有安全閥：只在名稱以 `_test` 結尾的資料庫上跑，否則拒絕執行
（避免清空正式庫）。需要：

1. 在同一台 MariaDB 上有 `AttentionLessonPlan_test` 這個庫（不存在就用 root 建：
   `CREATE DATABASE AttentionLessonPlan_test CHARACTER SET utf8mb4;`）。
2. `.env` 的 `DB_USER`/`DB_PASSWORD` 指向對測試庫有
   `SELECT/INSERT/DELETE/CREATE` 的帳號（ADR-0001 的 `seeder`），或本機直接用能連
   測試庫的帳號。
3. `tests/conftest.py` 會從 `tests/schema.sql` 建表。

未設 `TEST_DB_NAME` 時，需要 DB 的測試會 skip，純函式測試照跑。

### 啟動 App / 跑測試

```powershell
# 開發伺服器
.\.venv\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 5001
# → http://127.0.0.1:5001/docs

# 測試（不可並行，所有測試共用同一個測試庫、每個測試前後清空）
.\.venv\Scripts\python.exe -m pytest tests/ -q
```

改用 `uv` 之後：`uv run uvicorn main:app --reload --port 5001`、`uv run pytest`。

### git

**優先做法**：依上面 §E，向團隊要正式 repo 的存取權並 `git clone` 來做。

**若團隊確認沒有共用 repo、就以這份 zip 為準**，才在本地起版控：

```powershell
git init
git add -A
git commit -m "chore: import existing project as baseline"
git checkout -b <分支名>
```

分支命名依廠商慣例 `<功能>_<single|double>_<你的名字>`：

- 功能 B（登入）：`login_single_<yourname>`
- 功能 A（模式）：沒有現成代號，可用 `mode_single_<yourname>` 或跟團隊確認

commit 訊息結尾加：

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

（若你的 Claude Code 視窗有提供 `Claude-Session:` 連結，一併加在下一行。）

---

## 建議實作總順序

若一次做兩個功能，建議這個順序（把「碰同一個檔案」的改動集中，減少衝突）：

### 第 0 步：`uv` 遷移（spec B 附錄 A）

- 建 `pyproject.toml`（deps 從 `requirements*.txt` 搬過來，`requires-python = ">=3.10"`）
- `uv lock` → commit `uv.lock`
- README 更新指令
- 跑一次 `uv run pytest` 確認綠燈（版本鎖定後 `anyio` 坑消失）

### 第 1 步：功能 A（單／雙人模式）

照 spec A「實作順序」1–9：

1. `tests/schema.sql` + `tests/conftest.py`（`assessment_result` 加 `mode`/`pair_id`；
   `DbHelper.insert_session` 加預設參數）→ 既有測試應仍全綠
2. `models.py`：`SessionItem`/`GameSummary`/`GameTrend` 加 `mode`
3. `converters.py`：`normalize_mode_for_db` + 純函式測試
4. `queries.py`：`fetch_assessment_rows` 加 `mode` 篩選、`SELECT` 加 `mode`/`pair_id`
5. `routers/students.py`：三處分組加 `mode`；兩路由讀 `?mode=`；更新 `test_api.py`
   既有斷言（會多 `mode` 欄）+ 新增測試
6. `writes.py` + `routers/sessions.py`：POST 支援 `mode`/`pairId` + 驗證 + 測試
7. `seed.py`：灌雙人版假資料；手動跑 `python seed.py` 到 `_test` 肉眼驗證
8. `README.md` / `CONTEXT.md` 文件更新
9. （維運）正式庫 `ALTER TABLE`（見下）

每步 commit。

### 第 2 步：功能 B（登入／場域／老師）

照 spec B「實作順序」1–7：

1. `tests/schema.sql` 加 `school`、`teacher`；`conftest.py` 更新建表與清空清單
   （清空時 `teacher` 在 `school` 前）→ 既有測試應仍全綠
2. `seed_directory.py` + `tests/test_seed_directory.py`
3. `queries.py`：`fetch_schools`/`fetch_teachers`/`fetch_teacher`
4. `models.py`：`SchoolItem`/`SchoolListResponse`/`TeacherItem`/`TeacherListResponse`/
   `TeacherStudentsResponse`
5. `routers/directory.py` + `main.py` 掛 router + `tests/test_directory.py`
6. `README.md` / `CONTEXT.md` / `docs/adr/0001` 文件更新
7. （維運）正式庫建表、`GRANT` 給 `app_ro`、`seed_directory.py --prod`
   （**待場域字串定案後才做**）

每步 commit。

### 檔案衝突注意

A 和 B 都會改這幾個檔，若分兩條分支平行做，這些地方要留意 merge：

- `queries.py`（A 改 `fetch_assessment_rows`；B 加三個新函式 —— 不同函式，好合）
- `models.py`（A 改既有 class 加欄位；B 加新 class —— 好合）
- `tests/schema.sql`（A 改 `assessment_result`；B 加兩張表 —— 不同段落，好合）
- `tests/conftest.py`（A 改 `DbHelper.insert_session`；B 改建表/清空清單 —— 好合）
- `README.md` / `CONTEXT.md`（都加內容 —— 手動合）
- `main.py`（只有 B 改：`include_router(directory.router)`）

---

## 維運 / 上線 checklist

這些是**對正式庫的人工操作**，依 [ADR-0001](../adr/0001-least-privilege-db-accounts.md)
一律用 **root** 執行，不是 app 帳號。

### 功能 A 上線前（雙人版 Unity build 釋出前）

```sql
-- root，正式庫 AttentionLessonPlan
ALTER TABLE assessment_result
  ADD COLUMN mode    ENUM('single','double') NOT NULL DEFAULT 'single' AFTER game_type,
  ADD COLUMN pair_id varchar(36) DEFAULT NULL AFTER mode;
```

現有資料（含日後累積的單人版真實資料）自動變 `mode='single'`，不用回填。
`game_writer` 的 `INSERT` 權限不受加欄影響，不需重新授權。

### 功能 B 上線前（老師檢視頁上線前，且場域字串已定案）

```sql
-- root，正式庫
CREATE TABLE school ( ... );      -- 見 spec B
CREATE TABLE teacher ( ... );     -- 見 spec B
GRANT SELECT ON AttentionLessonPlan.school  TO 'app_ro'@'%';
GRANT SELECT ON AttentionLessonPlan.teacher TO 'app_ro'@'%';
FLUSH PRIVILEGES;
```

```powershell
# 灌 8 場域 + 16 老師（root 帳號）
$env:DB_USER="root"; $env:DB_PASSWORD="<root密碼>"
.\.venv\Scripts\python.exe seed_directory.py --prod
```

### Zeabur 部署

- `app_ro`／`game_writer` 的帳密在 **Zeabur 環境變數**，不在 repo。
- 加了 `mode`/`pair_id` 欄位、`school`/`teacher` 表後，**不需要改 Zeabur 設定** ——
  只要正式庫的 DDL 先跑完、`app_ro` 的 `SELECT` 授權補上。
- 若做了 `uv` 遷移，確認 Zeabur 的 build 能吃 `pyproject.toml`／`uv.lock`，或保留
  `uv export` 出來的 `requirements.txt`。

---

## 驗收（demo 給廠商看）

1. `python seed.py`（灌含雙人版的假資料）+ `python seed_directory.py`（灌場域老師）
   到 `_test` 庫。
2. 起 app，開 `/docs`。
3. 功能 B：`GET /api/schools` → `GET /api/schools/{一個場域}/teachers` →
   `GET /api/teachers/{一個 id}/students` → 拿一個 `studentKey` →
   `GET /api/students/{studentKey}/report?school=...`
4. 功能 A：上一步的 `/report` 回應裡，`summaryByGame` 應同時出現例如
   `{gameType: "DAT", mode: "single"}` 與 `{gameType: "DAT", mode: "double"}` 兩列；
   `/report?school=...&mode=double` 只回雙人版。
5. `POST /api/sessions` 帶 `data.mode="double"` + `data.pairId="<uuid>"` 的 DAT
   payload → `201` → 再查該學生 report，新場次 `mode` 為 `double`。
