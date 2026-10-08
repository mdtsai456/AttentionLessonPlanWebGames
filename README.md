# Attention Lesson Plan WebGames

注意力教案的網頁遊戲。學生登入後選單人或雙人，再進入遊戲；老師登入後看自己場域學生的進度。成績寫進 MariaDB，由 `backend/` 的 API 負責。

各資料夾的玩法、規則與實作寫在該資料夾的 README。這份只說明目錄、每個資料夾做什麼，以及怎麼把專案跑起來。

## 使用流程

1. 開啟根目錄 `index.html`，或本機的 `/app/`。兩者都會進到 `Home/`。
2. `Home/` 選擇學生或老師。學生再選單人或雙人。
3. 學生進入 `Select/` 選遊戲。選完先到 `Tutorial/` 的說明頁，再進對應遊戲。
4. 老師進入 `Teacher_platform/` 看學生進度。
5. 遊戲結束後，頁面透過 `shared/` 把成績送到 `backend/`。

雙人是同一台裝置、兩位學生各自登入。雙人沒有「指令出擊」。

## 目錄

```text
.
├── index.html                 正式站入口，轉到 Home/
├── zbpack.json                Zeabur 靜態網站部署設定
├── Home/                      登入：身份、單人／雙人
├── Select/                    學生選遊戲、看當天進度
├── Teacher_platform/          老師看學生進度
├── Tutorial/                  各遊戲開始前的說明頁
├── shared/                    登入守門、API、計時與共用畫面
├── DCCS_single/               賽道攔截・單人（引擎、關卡、素材）
├── DCCS_double/               賽道攔截・雙人入口
├── DAT_single/                動物追擊令・單人
├── DAT_double/                動物追擊令・雙人
├── EFT_single/                漂浮泡泡・單人
├── EFT_double/                漂浮泡泡・雙人
├── TGame_single/              勇闖迷宮・單人
├── TGame_double/              勇闖迷宮・雙人
├── IM_single/                 指令出擊（只有單人）
├── backend/                   FastAPI，讀寫 MariaDB
├── tools/                     產生 DCCS 關卡清單、勇闖迷宮測試
└── tests/                     前端單元測試與瀏覽器測試
```

頁面之間用相對路徑互相引用。部署或本機掛載時要保留這層目錄，不要把單一遊戲資料夾單獨抽出來開。

## 資料夾

| 資料夾 | 畫面上的名稱 | 做什麼 |
| --- | --- | --- |
| `Home/` | 登入 | 學生或老師登入。學生接著選單人／雙人。說明見 `Home/README.md`|
| `Select/` | 選擇遊戲 | 列出可玩的遊戲與當天進度。雙人要兩人選同一個遊戲才進入。 說明見 `Select/README.md`|
| `Teacher_platform/` | 學生進度 | 老師查看自己場域學生的場次與報告。說明見 `Teacher_platform/README.md` |
| `Tutorial/` | 遊戲說明 | 選完遊戲後的規則頁，確認後才進入遊戲本體。說明見 `Tutiroal/README.md` |
| `shared/` | — | 各頁共用的登入檢查、後端位址、成績送出、離開確認、計時與過關畫面。說明見 `shared/README.md` |
| `DCCS_single/` | 賽道攔截 | 單人。說明見 `DCCS_single/README.md`、`DCCS_single/SPEC.md`。 |
| `DCCS_double/` | 賽道攔截・雙人 | 雙人。自己有一份引擎、關卡表與素材，擺法和單人相同。說明見 `DCCS_double/README.md` |
| `DAT_single/` | 動物追擊令 | 單人。選單上的名稱是「瓢蟲追擊令」。說明見 `DAT_single/README.md`。 |
| `DAT_double/` | 動物追擊令・雙人 | 雙人。說明見 `DAT_double/README.md`。 |
| `EFT_single/` | 漂浮泡泡 | 單人。說明見 `EFT_single/README.md`。 |
| `EFT_double/` | 漂浮泡泡・雙人 | 雙人。與單人共用 `shared/` 裡的玩家流程。說明見 `EFT_double/README.md` |
| `TGame_single/` | 勇闖迷宮 | 單人。 說明見 `TGame_single/README.md`|
| `TGame_double/` | 勇闖迷宮・雙人 | 雙人。 說明見 `TGame_double/README.md`|
| `IM_single/` | 指令出擊 | 只有單人版。說明見 `IM_single/README.md` |
| `backend/` | — | 登入、成績、學生報告 API。說明見 `backend/README.md`。 |
| `tools/` | — | `build_manifest.py` 依 DCCS 關卡表產生 `manifest.json`。`tools/tgame-tests/` 是勇闖迷宮的瀏覽器測試。 |
| `tests/` | — | 遊戲規則與全站登入、流程、存檔的自動化測試。說明見 `tests/README.md`。 |

選單代號、資料夾和成績代號一致：瓢蟲追擊令送 `DAT`，漂浮泡泡送 `EFT`。

| 選單代號 | 畫面名稱 | 資料夾 |
| --- | --- | --- |
| `DCCS` | 賽道攔截 | `DCCS_single/`、`DCCS_double/` |
| `DAT` | 瓢蟲追擊令 | `DAT_single/`、`DAT_double/` |
| `EFT` | 漂浮泡泡 | `EFT_single/`、`EFT_double/` |
| `TGame` | 勇闖迷宮 | `TGame_single/`、`TGame_double/` |
| `InstructionGame` | 指令出擊 | `IM_single/` |

成績怎麼送、素材怎麼抓，寫在各遊戲資料夾的 README。

## 本機啟動

需要 Python 3.10 以上、[uv](https://docs.astral.sh/uv/)，以及一組可連線的 MariaDB。後端會一併提供前端頁面，不用另開靜態伺服器。

```bash
cd backend
cp .env.example .env
```

在 `.env` 填入資料庫帳密。本機前端對測試庫時，`DB_NAME` 指到 `AttentionLessonPlan_test`。欄位說明與測試帳號見 [`backend/README.md`](backend/README.md)。

後端:
```bash
cd backend
.\.venv\Scripts\uvicorn.exe main:app --reload --host 127.0.0.1 --port 5001
```
前端:
```bash
python -m http.server 8080
```

- 登入頁：<http://127.0.0.1:5001/app/>
- API 文件：<http://127.0.0.1:5001/docs>
- 存活檢查：<http://127.0.0.1:5001/health>

Windows PowerShell 同樣使用上面的指令；複製環境檔可改成 `Copy-Item .env.example .env`。

`/app/` 底下掛的是白名單裡的頁面目錄（`Home`、`Select`、各遊戲、`shared`、`Tutorial` 等）。在 `localhost` 或 `127.0.0.1` 另開靜態伺服器、從根目錄 `index.html` 進入時，前端會把 API 打到同一台機器的 `5001` port。

改過 `DCCS_single/levels.json` 或 `DCCS_single/assets/` 後，要重產關卡清單：

```bash
python tools/build_manifest.py
```

## 正式環境

前端是 Zeabur 靜態網站，設定在根目錄 `zbpack.json`，輸出目錄是專案根目錄。開啟 <https://attention-webgames.zeabur.app/> 會經由 `index.html` 進入 `Home/`。

後端是另一個 Zeabur 服務：<https://attention-lesson-plan-data.zeabur.app>，API 前綴為 `/api`。後端環境變數要放行前端網域：

```text
CORS_ALLOW_ORIGINS=https://attention-webgames.zeabur.app
```

只填 origin，不含路徑或結尾斜線。已有其他網域時，用逗號接在後面。改完後重新部署後端。

## 測試

| 範圍 | 位置 | 怎麼跑 |
| --- | --- | --- |
| 後端 API 與資料庫 | `backend/` | `uv run pytest -q`（須設定名稱以 `_test` 結尾的 `TEST_DB_NAME`） |
| 動物追擊令規則與流程 | `tests/` | `cd tests && npm install && npm test` |
| 登入、選遊戲、存檔、舊網址 | `tests/frontend/` | `cd tests/frontend && npm install && npx playwright install chromium && npm test` |
| 勇闖迷宮 | `tools/tgame-tests/` | `npm ci --prefix tools/tgame-tests && npm --prefix tools/tgame-tests test` |

各套測試的環境變數與覆蓋範圍寫在對應 README，不在這份重複。
