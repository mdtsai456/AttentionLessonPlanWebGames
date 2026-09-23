# 用最小權限 DB 帳號取代到處用 root

日期:2026-07-10 · 狀態:accepted

## 脈絡

原本 app、`seed.py`、測試套件全部共用同一組**遠端可連的 `root`**(`db.py` 從
`.env` 讀 `DB_USER/DB_PASSWORD`)。DB 對外網開放(port 31913),等於把最高權限
的鑰匙暴露在最大的攻擊面上。而這支 API 其實**只讀**(`queries.py` 全是 `SELECT`)。

## 決策

依「唯讀 vs 寫入」這條天然斷層,建立兩個非 root 帳號,root 退居人工維運:

| 帳號 | 權限 | 綁定庫 | 給誰 |
|---|---|---|---|
| `app_ro` | `SELECT` | `AttentionLessonPlan`(正式) | 部署在 Zeabur 的讀取 API |
| `seeder` | `SELECT, INSERT, DELETE, CREATE` | **只** `AttentionLessonPlan_test` | `seed.py`(預設)+ 測試套件 |
| `root` | 全權 | 全域 | 只人工維運;正式庫的灌注也走它 |

**關鍵取捨 —— `seeder` 只綁 `_test`,不給正式庫。** 正式庫的「先清空再灌」改由
root 手動執行。理由:`seeder` 是每天跑測試、且會被編進測試流程的帳號,不該有能力
刪掉正式庫資料 —— 尤其下週起正式庫將開始寫入真實受試者資料。方便性損失極小
(少數幾次正式庫灌注改用 root),換來「測試帳號手滑/外洩不會毀掉研究資料」。

- host 一律 `'@%'`:app(Zeabur)與開發機皆無固定對外 IP,綁不住。防護靠「最小
  權限 + 非 root + 強密碼」,不靠 host。拿到固定 IP 後再收緊列為日後強化。
- 密碼:建立時暫用同一組已知字串,**上線前必須輪換**(該字串已外流),輪換時
  各帳號各自一組。

## 效果

- app 即使被打穿,`app_ro` 也只能讀,改不了正式庫。
- `seed.py` 預設走 `seeder`/`_test`;`--prod` 走 root 閘門(見
  [plan](../superpowers/plans/2026-07-10-seed-mock-data.md))。
- 帳密分兩處配置:DB 伺服器端建帳號,app 端的 `app_ro` 與 `game_writer`
  分別住在 **Zeabur 環境變數**與本機 `.env`。

## 後續實施

- 2026-07-16 已建立 `game_writer`，只對正式庫的 `student`、
  `assessment_result` 與五張遊戲結果表授予 `INSERT`。GET 與 POST 在 app 內使用
  獨立 read/write connections；`app_ro`/`seeder` 權限不變。
- 真資料進正式庫後,`seed.py --prod`(wipe-and-fill)應退役或加閘門。
- 場域／老師名錄功能新增 `school`、`teacher` 兩張表後，`app_ro` 需要對它們的
  `SELECT`（由 root 執行；待場域字串定案、正式庫建表後補上）：
  `GRANT SELECT ON AttentionLessonPlan.school TO 'app_ro'@'%';`
  `GRANT SELECT ON AttentionLessonPlan.teacher TO 'app_ro'@'%';`
  `seeder` 是 `_test` 庫級授權，已涵蓋這兩張新表，不需額外處理。
  `seed_directory.py --prod` 灌參照資料時走 root（不是 `seeder`，`seeder` 無正式庫權限）。
