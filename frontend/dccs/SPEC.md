# 賽道攔截 DCCS — 單人模式實作規格

本檔是實作的唯一依據。所有模組必須嚴格照這裡的 API 簽名實作，
不得自行更改函式名稱、參數順序或回傳結構。

---

## 0. 絕對禁止事項

- **不得修改 `frontend/dccs/assets/`** 底下任何檔案。它只能被讀取。
- 中介平台（`AttentionLessonPlanTransferDataPlatform`）的原始碼不在本 repo，
  需要參考時請直接讀取外部那一份，不要複製；真的需要複製時，
  複製品也不得修改。

---

## 1. 遊戲機制（已由廠商 demo 影片逐格確認，不是推測）

第一人稱視角，鏡頭沿一條固定的賽道前進，畫面上沒有玩家角色。

```
        遠 ─────────────────────────────────────────── 近
                  ┌──────────────┐
   目標物 ────────▶│ 🐄 in □ 黃框 │  沿賽道中央線由遠而近、等速逼近並放大
                  └──────────────┘
   形狀閥 ──────────  □      △        一排「外框圖案」，只能往左轉
   物件閥 ────────  ✏️        🐕       一排「物件圖」，只能往右轉
```

### 1.1 目標物

目標物有兩個可為空的欄位：

```
Target = { frame: ShapeAsset | null , content: ImageAsset | null }
```

- `frame` 有值 → 畫成一個黃色外框
- `content` 有值 → 畫在外框內部（若無外框則單獨畫）
- 兩者皆有值 = **複合題**，要連過兩道閥

### 1.2 控制閥（Valve）

一道閥是一個**環狀的選項輪盤**，N 個選項首尾相接。

**按一下＝轉一整格，動畫跑完自動對齊停住**（不是「按住持續轉、放開就停」，
那樣會停在兩格之間，選項對不準賽道中央）。

- **邊緣觸發**：一次按下（keydown）＝排入一格。按住不放**不會**連續轉，
  要再轉一格就得放開再按。
- 動畫進行中再按會**累積進佇列**（連按 3 下就依序轉 3 格），
  不會因為動畫還沒跑完就把輸入吃掉。
- 每格的滑動動畫時間 = `ROT_SEC_PER_SLOT`（0.30 秒），
  動畫結束時 `theta` 必定落在整數格上。
- **每道閥只能往一個固定方向轉**，轉過頭必須繞完一整圈才回得來
  （這是刻意的認知負荷，也是 `slotsRotated` 想量到的東西）。
- 形狀閥：方向 `-1`（往左），單人鍵 `ArrowLeft` 或 `KeyA`
- 物件閥：方向 `+1`（往右），單人鍵 `ArrowRight` 或 `KeyD`

### 1.3 判定

目標物的 `z` 通過某道閥所在的 `z` 平面時，觸發**一次判定**：
取該閥當下**最接近賽道中央**的選項作為玩家的答案。

- `frame ≠ null` → 通過形狀閥時判定一次
- `content ≠ null` → 通過物件閥時判定一次
- 複合題共產生 2 次判定

**答錯不中斷遊戲、不扣分、沒有錯誤動畫，只記錄。**
答對時畫面右上顯示綠色 ✓ 約 0.6 秒，得分 +1。

### 1.4 規則（規則不顯示給玩家，要自己從畫面推）

**每一題都是複合題**：目標物必定同時有外框與內容，必定連過兩道閥、
產生兩次判定。

```
形狀閥 ─▶ 永遠是 frame 規則：選與目標外框形狀相同者
物件閥 ─▶ 規則由「關卡」指定（見 1.5），不從選項反推：
           objectRule = 'model'    → 選與目標完全相同的那一張
           objectRule = 'category' → 選與目標同一個語意類別者
```

「類別」即 `assets/` 底下的一個資料夾，同資料夾內的圖屬同一語意類別。

### 1.5 關卡

**關卡是遊戲設計，寫在 `frontend/dccs/levels.json`（人工維護的設計表）。**
每一關綁定一組**固定的素材**，整關不換（見 1.7）。

**兩道閥的選項數是各自獨立的**，關卡表要分別指定：

| 關卡 | 形狀閥 `shapeCount` | 物件閥 `objectCount` | 物件閥規則 | 物件閥素材 |
|---|---|---|---|---|
| 1 | 5 | 2 | `model` | `assets/2/` 全部 2 張 |
| 2 | 5 | 3 | `model` | `assets/3/` 全部 3 張 |
| 3 | 2 | 4 | `category` | 4 個類別各固定一張 |
| 4 | 2 | 4 | `model` | `assets/4/` 全部 4 張 |
| 5 | 2 | 5 | `model` | `assets/5/` 全部 5 張 |

**現有素材剛好全部用得到，一張都不必補。** 四個數字資料夾各對應一個
`model` 關，四個類別合起來湊第 3 關的 `category`。

形狀閥的素材永遠是 `shapes` 依檔名排序的**前 `shapeCount` 個**。

這張表複刻廠商 demo 影片 `dccs demo 1-5.mov`，但物件閥的選項數**刻意與影片
不同**（見下方）。影片各關節奏一致，**難度不靠速度**。

> 物件閥的 `2/3/4/4/5` 是影片實際值 `2/4/5/5/6` 的同構下移（現有素材剛好夠用）。
> **不要改成 `2/4/5/5/6`，也不要為了難度單調把第 3、4 關對調。**
> 形狀閥的 `5/5/2/2/2` 完全照影片，不要動；形狀最多用 5 個，不需要第 6 個形狀。

第 3 關是唯一的 `category` 關，其餘四關都是 `model`。

`model` 關的素材來源寫在 `levels.json` 的 `sourceCategory`，
**不是靠資料夾名稱推導**（換素材只要改 `levels.json`）。

**每關時長 = `SESSION_SECONDS / 關卡數` = 600 / 5 = 120 秒**，仍由 `Track`
依 `manifest.levels.length` 推導，**不得寫死**。

### 1.6 出題可行性

每一題都是複合題，所以一關要能出題，**`frame` 與該關的 `objectRule`
必須同時可行**（不可行的那一半不得降級或略過）：

| 條件 | 需求 |
|---|---|
| `frame` | `shapes` 數量 ≥ 該關的 `shapeCount` |
| `model` | `sourceCategory` 指定的類別存在，且圖片數 ≥ 該關的 `objectCount` |
| `category` | `sourceCategories` 列出的類別都存在，且數量 = 該關的 `objectCount` |

任一不可行 → 該關無法出題：`trialGen.next()` 回 `null`，
`build_manifest.py` 把該關標成 `playable: false` 並寫一行
`WARN: level <關卡序號> unplayable (<原因>)` 進 manifest 的 `warnings`。
遊戲照常進行，只是那一關空過；warnings 只留在 `DCCSResult`，不送平台、
也不寫入成績 TXT。

**目前沒有素材缺口**：五關全部 playable，`warnings` 為空。

### 1.7 素材固定（每關一組，整關不換）

**同一關的整場遊戲用同一組圖**，不是每題重抽（影片行為）。
一關的素材在**該關開始時決定一次**，之後固定：

- 形狀閥：`shapes` 依檔名排序的**前 `shapeCount` 個**
- 物件閥（`model` 關）：`sourceCategory` 那個類別的**全部** `objectCount` 張圖
- 物件閥（`category` 關）：`sourceCategories` 列出的 `objectCount` 個類別，
  **每類固定取一張作為閥門代表圖**（取該類別依檔名排序的第一張，可預測、
  跨場次可比）。但目標物的內容圖片池要囊括這些類別底下的**全部圖片**；
  用洗牌袋逐張出題，整袋全部出完以前不得重複，出完後才重新洗牌。

因此**每一題變化的只有兩件事**：

1. 目標圖片：形狀與 `model` 物件從固定選項中選；`category` 物件則從四個
   類別的完整圖片池中取下一張（不要求與閥門代表圖是同一張，只要類別相同）
2. 選項在閥上的**排列順序**（每題重新洗牌，兩道閥各自洗）

第 1 關的物件閥只有 2 張圖、組合數很少，這是刻意的：那一關的難度靠形狀閥的
5 選 1。

---

## 2. 座標系統與投影常數

背景圖 `assets/Single.png` 為 1672×941。以下比例值由實際量測取得，
直接寫進 `config.js`，**不要自己改**：

| 常數 | 值 | 意義 |
|---|---|---|
| `VANISHING_Y` | `0.385` | 賽道消失點的 y，佔畫布高度比例 |
| `BASE_Y` | `1.04` | z=0（鏡頭所在）的 y，佔畫布高度比例 |
| `ROAD_CX` | `0.500` | 賽道中心 x，佔畫布寬度比例 |
| `ROAD_HALF_W` | `0.344` | z=0 時賽道半寬，佔畫布寬度比例 |
| `CAM_DEPTH` | `10.5` | 透視深度參數 D |
| `SPRITE_BASE` | `0.205` | z=0 時 sprite 的邊長，佔畫布高度比例 |
| `TARGET_PERSPECTIVE` | `0.6` | **只給目標物用**的縮放指數，見下方 |

> 這些是實測後的定案值，**不要憑「幾何上比較正確」之類的理由回頭改**：
> `VANISHING_Y = 0.385` 刻意高於真地平線（`0.489`），`BASE_Y = 1.04` 大於 1
> 也是刻意的（z=0 在畫面下緣外），都不是筆誤。`TARGET_PERSPECTIVE` 只影響
> 目標物，兩排選項一格都不動。側邊選項的 3D 斜切不做。
> **以上全部是純繪製常數，不得影響任何一筆成績數字**（見第 8 節驗收）；
> 會影響資料的是 `Z_SPAWN` 與 `TARGET_SPEED`。

投影公式（`z` 為世界深度，0 = 鏡頭處，愈大愈遠）：

```
s(z)      = CAM_DEPTH / (z + CAM_DEPTH)          // 縮放係數，z=0 時為 1
screenY   = (VANISHING_Y + (BASE_Y - VANISHING_Y) * s) * H
screenX   = ROAD_CX * W + lane * ROAD_HALF_W * W * s
spriteSize= SPRITE_BASE * s * H                              // 閥上的選項
targetSize= SPRITE_BASE * s^TARGET_PERSPECTIVE * H           // 只有目標物
```

`TARGET_PERSPECTIVE` 為 `1` 時 `targetSize` 與 `spriteSize` 完全相同 ——
實作時請保持這個性質（`Math.pow(s, 1) === s`），它是回歸驗證的錨點。

`lane` 是橫向座標，單位為「賽道半寬」：`lane = 0` 是賽道正中，
`lane = ±1` 是賽道左右邊緣，`|lane| > 1` 在草地上。

### 2.1 兩道閥的位置

| 閥 | z | 對應 screenY |
|---|---|---|
| 形狀閥 `Z_VALVE_SHAPE` | `12.0` | ≈ 0.691 H |
| 物件閥 `Z_VALVE_OBJECT` | `4.0` | ≈ 0.859 H |

目標物自 `Z_SPAWN = 38.0`（≈ 0.527 H）出現，
以 `TARGET_SPEED = 7.0` 單位／秒向鏡頭移動，抵達 `z = 0` 時消滅。
一題約 5.4 秒。

### 2.2 閥上選項的排列（**單側佇列**，2026-09-10 第三輪改版）

**選項不是以賽道中央為軸左右對稱展開的**（那是舊版的做法，已廢止），
而是排成一條**只往自己那一側延伸**的佇列：

- 形狀閥（上排）的佇列往 **右**
- 物件閥（下排）的佇列往 **左**

因此每道閥在畫面上原則上只看得到兩個（中央那一個 ＋ 佇列上的下一個），
選項最多的關卡也只看得到三個。**上下兩排各佔一側**，這就是「分得清左右」
的來源，也是廠商影片的實際做法。

第 `i` 個選項（`i` 由 0 起算，共 N 個）：

```
off  = wrapUnsigned(direction * (i - theta) + 0.5, N) - 0.5   // 落在 [-0.5, N-0.5)
lane = -direction * off * SLOT_LANE_SPACING                   // SLOT_LANE_SPACING = 1.30
```

- `direction` 就是這道閥的轉向（形狀閥 `-1`、物件閥 `+1`）；
  `-direction` 決定佇列在哪一側，兩道閥天生互為鏡像，不需要多一個設定。
- `off === 0` 的那一個永遠就是 `centerIndex()`（賽道正中、會被判定的那一個）。
  其餘排在 `off = 1, 2, … N-1`，**全部在同一側**。
- 轉動時 `off` 遞減：佇列上的下一個從外側滑進中央，原本在中央的那個
  滑出到 **另一側** 半格（`off` 到 `-0.5`）後環繞回佇列尾端 `N-0.5`。
  N 大時尾端早就在畫面外，看不到跳格；N = 2 時看得到它從另一頭補回來
  —— 影片也是這樣。
- **轉動途中中央會短暫淨空**，這是正確行為，不是缺圖。
- `|lane| > SLOT_RENDER_LIMIT`（4.0）者不繪製。真正的視覺裁切是 viewport 的
  clip，`SLOT_RENDER_LIMIT` 只是省掉明顯在畫面外的繪製，**不再**是
  「畫面上要顯示幾個」的控制項（顯示幾個由上面的幾何自然決定）。

`SLOT_LANE_SPACING = 1.30` 由影片量測反推而得，而它的換算依賴 `CAM_DEPTH`
（單位是 lane，換算成像素要乘 `ROAD_HALF_W * W * s(z)`）——
**日後若再動 `CAM_DEPTH`，這個常數必須重算。**

靜止時的可見數量：形狀閥在第 1、2 關是 3 個、第 3–5 關是 2 個；
物件閥五關一律 2 個。

`theta` 是實數，滑動才會平滑；但它**只在動畫進行中才是非整數**。
每次 `step()` 把目標格 `+1`（乘上方向），`update(dt)` 讓 `theta` 在
`ROT_SEC_PER_SLOT` 秒內平滑趨近該目標格，**到達後必須精確等於整數**
（不可留下浮點殘差，否則 `centerIndex()` 會在邊界上跳動）。
閒置時 `theta` 恆為整數，選項必定對齊賽道中央。

---

## 3. 目錄結構

```
AttentionLessonPlanWebGames/
├── backend/                                         ← 中介平台（FastAPI）
│   └── main.py                                      ← 一併把 frontend/ 掛在 /app
├── tools/
│   └── build_manifest.py                            ← 掃 assets/ 產生 manifest
└── frontend/
    └── dccs/
        ├── SPEC.md                                  ← 本檔
        ├── README.md                                ← 啟動說明
        ├── index.html
        ├── double.html                              ← 雙人模式殼
        ├── levels.json                              ← 關卡設計表（人工維護，見 5.1）
        ├── manifest.json                            ← 由 build_manifest.py 產生
        ├── assets/                                  ← 唯讀，遊戲素材
        ├── css/{style,double}.css
        └── js/
            ├── config.js
            ├── dccs.js                              ← 公開 API（main 專案的進入點，見 4.15）
            ├── main.js                              ← 獨立執行用的殼（見 4.14）
            ├── double.js                            ← 雙人模式殼
            ├── ui/overlays.js                       ← 遊戲自帶的畫面層（見 4.16）
            ├── lobby.js                              ← 與中介平台大廳的銜接（見 4.13c）
            ├── core/{loop,input,assets}.js
            ├── render/{projection,road,hud}.js
            ├── game/{valve,target,rules,trialGen,stats,track}.js
            └── net/{client,apiBase}.js
```

前端使用 **原生 ES modules**（`<script type="module">`），無框架、無打包工具、
無 CDN 相依。

---

## 4. 模組 API（實作必須完全符合）

### 4.1 `js/config.js`

匯出一個凍結物件 `CONFIG`，至少包含第 2 節所有常數，另加：

```js
export const CONFIG = Object.freeze({
  // 投影
  VANISHING_Y: 0.385, BASE_Y: 1.04, ROAD_CX: 0.5,
  ROAD_HALF_W: 0.344, CAM_DEPTH: 10.5, SPRITE_BASE: 0.205,
  TARGET_PERSPECTIVE: 0.6,
  // 賽道
  Z_SPAWN: 38.0, Z_VALVE_SHAPE: 12.0, Z_VALVE_OBJECT: 4.0, TARGET_SPEED: 7.0,
  // 閥
  ROT_SEC_PER_SLOT: 0.30, SLOT_LANE_SPACING: 1.30, SLOT_RENDER_LIMIT: 4.0,
  // 場次
  SESSION_SECONDS: 600,
  // 注意：這裡不包含 LEVEL_SECONDS。每關時長 = SESSION_SECONDS / 關卡數，
  // 由 track.js 依 manifest.levels.length 在執行期推導（見 1.5 / 4.12），
  // 不得在 CONFIG 中寫死。
  // 回饋
  TICK_FEEDBACK_SECONDS: 0.6,
  // HUD：分數條的視覺滿格基準。分數沒有上限，這只影響進度條畫多長。
  SCORE_BAR_FULL: 60,
  // 迴圈
  FIXED_DT: 1 / 60, MAX_FRAME_DT: 0.25,
});
```

### 4.2 `js/core/loop.js`

固定時間步迴圈。**反應時間是研究數據，邏輯更新必須與畫面更新率脫鉤。**

```js
export function createLoop({ update, render }) -> {
  start(): void,
  stop(): void,
  isRunning(): boolean,
}
```

- `update(dt)` 以固定 `CONFIG.FIXED_DT` 呼叫，使用 accumulator 補齊；
  單幀最多補到 `CONFIG.MAX_FRAME_DT`，超出直接丟棄（避免分頁切回時暴衝）。
- `render(alpha)` 每個 animation frame 呼叫一次，`alpha` 為內插係數 0..1。

### 4.3 `js/core/input.js`

```js
export function createInput(bindings) -> {
  isDown(action): boolean,        // 仍保留，供除錯與未來用
  takePresses(action): number,    // 取出並清空這個 action 累積的按下次數
  destroy(): void,
}
```

`bindings` 形如 `{ rotateShape: ['ArrowLeft','KeyA'], rotateObject: ['ArrowRight','KeyD'] }`
（使用 `KeyboardEvent.code`）。必須在按鍵 `preventDefault()` 以免捲動頁面。

**`takePresses()` 是邊緣觸發的計數器**（見 1.2）：

- 每次 `keydown` 讓對應 action 的計數 `+1`，`keyup` 不影響計數。
- **必須擋掉瀏覽器的按鍵自動重複**：按住不放時瀏覽器會連續送出 `keydown`
  （`event.repeat === true`），這些**不計數**。一次實體按下只算一次。
- 呼叫 `takePresses(action)` 回傳目前累積次數並歸零（`Track.update()` 每幀取
  一次，不重複消費也不漏掉）。
- 同一個 action 綁多個鍵（`ArrowLeft` 與 `KeyA`）時，兩個鍵各自算一次按下。

**失焦時要清空**：`blur` / `visibilitychange` 除了清 `down` 集合，也要把累積的
按下次數歸零（alt-tab 前按到一半的輸入不該在切回來後才生效）。

`createInput` 只吃 bindings，**不得讀取全域按鍵表**，才能建立兩個各綁不同鍵
的實例（雙人版）。

### 4.4 `js/core/assets.js`

```js
export async function loadManifest(url) -> Manifest
export async function preloadImages(manifest, assetBase) -> Map<string, HTMLImageElement>
```

`preloadImages` 必須載入 manifest 內所有圖片（背景、shapes、所有 categories 的
images），全部 `decode()` 完成後才 resolve。**`load` 失敗**（`img.onerror`）
即 reject 並指出檔名。Map 的 key 是資產的 `id`。

**`decode()` 本身失敗或不被支援時仍視為載入成功**（以 `onload` 為準）：
`decode()` 在分頁不可見時可能永遠不 settle，當成必要條件會卡在載入畫面。

**`assetBase`**：manifest 裡的 `src` 是**相對路徑**（`assets/...`，見第 5 節），
實際網址是 `new URL(src, assetBase).href`。`assetBase` 由呼叫端（`js/dccs.js`）
給，預設 `new URL('../../', import.meta.url)`（＝專案根）；`loadManifest` 的
`url` 同理，不設寫死預設值。**模組內不得出現以 `/` 開頭的寫死路徑**（遊戲被掛
在子目錄下時絕對路徑會全部失效）。

### 4.5 `js/render/projection.js`

純函式，無狀態，**必須可在 Node 中單獨測試**。

```js
export function scaleAt(z) -> number
export function project(z, lane, viewport) -> { x, y, scale, size }
export function zAtScale(s) -> number
export function targetSizeAt(z, viewport) -> number
```

`targetSizeAt` 是**目標物專用**的大小（見第 2 節）：
`CONFIG.SPRITE_BASE * Math.pow(scaleAt(z), CONFIG.TARGET_PERSPECTIVE) * viewport.h`。
`project()` 回傳的 `size` 仍是閥上選項用的 `SPRITE_BASE * s * h`；
`TARGET_PERSPECTIVE === 1` 時兩者必須完全相等。

`viewport` 形如 `{ x, y, w, h }`（畫布內的像素矩形，為雙人版分割畫面預留）。
所有比例常數乘上 `viewport.w` / `viewport.h`，並加上 `viewport.x` / `viewport.y`。

### 4.6 `js/render/road.js`

```js
export function drawBackground(ctx, bgImage, viewport) -> void
export function drawSprite(ctx, image, z, lane, viewport, opts?) -> void
```

`drawSprite` 依 `project()` 的結果置中繪製；`opts.inner` 若給定（另一張 image），
則在外框圖案中央以 `0.5 ×` 尺寸疊繪（用於複合目標物）。

`opts.size` 若給定就取代 `project()` 算出的 `size`（位置仍由 `project()` 決定），
`opts.inner` 也跟著用這個尺寸的一半。這是給目標物用的（`track.js` 傳
`targetSizeAt(z, viewport)` 進來）；**閥上的選項不得傳 `opts.size`**。
背景以 cover 方式填滿 viewport，且必須讓背景的地平線對齊 `VANISHING_Y`
所隱含的位置（背景圖原生比例 1672:941，以寬度為準縮放，垂直靠上對齊）。

### 4.7 `js/render/hud.js`

```js
export function drawHud(ctx, viewport, state) -> void
```

`state` 形如：

```js
{ score: number, elapsed: number, total: number, level: number, showTick: boolean }
```

繪製：左上「得分」膠囊 + 進度條 + 分數；左側直立標題「賽道攔截」+ 垂直進度條
（`elapsed / total`）；`showTick` 為真時右上畫綠色 ✓。
不使用外部字型，用 system font stack。

### 4.8 `js/game/valve.js`

```js
export class Valve {
  constructor({ items, direction, z, kind })
  // items: Array<AssetRef>（長度 N）
  // direction: -1 | +1
  // z: number，此閥所在深度
  // kind: 'shape' | 'object'

  get theta(): number
  get isMoving(): boolean          // 動畫進行中（theta 不在整數格上）
  get pendingSteps(): number       // 佇列中還沒轉完的格數
  step(count = 1): void            // 排入 count 格（見 1.2，邊緣觸發呼叫）
  update(dt): void                 // 推進動畫，每格耗時 CONFIG.ROT_SEC_PER_SLOT
  centerIndex(): number            // 最接近賽道中央的選項索引
  answer(): AssetRef               // items[centerIndex()]
  slots(): Array<{ item, lane }>   // 供繪製，單側佇列（見 2.2），已過濾 |lane| > SLOT_RENDER_LIMIT
}
```

**不要加回 `rotate(dt)`**（舊的「按住持續轉」模型）。改由 `step()` 排入格數、
`update(dt)` 推進動畫：

- `step(count)` 把 `count` 格加進佇列；佇列不設上限，連按幾下就轉幾格。
- `update(dt)` 每幀以 `dt / ROT_SEC_PER_SLOT` 的比例朝當前這一格的終點推進，
  **推進量必須夾住**，不可以一幀衝過終點還繼續吃下一格的進度
  （低幀率時一幀的 dt 可能大於一格的時間，要把剩餘的 dt 留給下一格，
  或至少精確停在終點）。
- 一格走完時 `theta` **必須被設成精確的整數**（用累計的整數格數重算，
  不要靠浮點累加的結果），否則殘差會讓 `centerIndex()` 在邊界跳動。
- 佇列空且動畫結束時 `isMoving` 為 `false`，`theta` 為整數。

`centerIndex()` 必須用 `((Math.round(theta) % N) + N) % N` 之類的正確取模，
`theta` 為負數時也要正確。

`slots()` **必須照 2.2 的單側佇列公式**（不得用左右對稱的 `wrapSigned`），
且只影響繪製，不得改動 `centerIndex()` / `answer()` 的語意。

### 4.8b `js/game/target.js`

```js
export function createTarget(targetSpec, spawnZ) -> Target
export function stepTarget(target, dt, speed): void
export function hasReachedZ(target, z) -> boolean
```

`Target` 形如：

```js
{
  frame: AssetRef,        // 來自 Trial.target.frame
  content: AssetRef,      // 來自 Trial.target.content
  z: number,              // 世界深度，出生時為 CONFIG.Z_SPAWN，向鏡頭遞減
  ageMs: number,          // 自出生起的存活毫秒數
  passedShape: boolean,   // 是否已通過形狀閥（防止同一道閥重複判定）
  passedObject: boolean,
}
```

- `stepTarget` 每個時間步做兩件事：`z -= speed * dt`、`ageMs += dt * 1000`。
- `hasReachedZ` 用 `target.z <= z`（由遠而近，`z` 遞減）。
- `ageMs` 是 `settleMs` / `firstInputMs` 的共同時間基準（見 4.11）：
  `valve.noteInput()` 記下的時間戳與 `_judge()` 讀到的時間戳都取自它，
  兩者才能直接相減。**不要改用牆上時鐘**，理由同 4.11 的 `duration`。
- 純資料 + 純函式，不吃任何全域狀態，可在 Node 中單獨測試。

### 4.9 `js/game/rules.js`

純函式，**必須可在 Node 中單獨測試**。

```js
export function ruleForValve(valve, objectRule) -> 'frame' | 'category' | 'model'
export function isCorrect(rule, target, answer) -> boolean
```

- `ruleForValve`：`kind === 'shape'` → `'frame'`；否則直接回傳傳入的
  `objectRule`（即該題所屬關卡指定的規則，見 1.4 / 1.5）。
  `objectRule` 不是 `'model'` 或 `'category'` 時要 throw，不要默默回傳
  預設值 —— 這種錯會直接污染成績欄位。

> **不要從 `items` 的 `categoryId` 反推規則**（舊版做法，會無聲地把整關規則
> 標錯）。規則是關卡的屬性，一路從 `levels.json` 傳到判定，不重新推導。
- `isCorrect`：
  - `frame` → `answer.id === target.frame.id`
  - `category` → `answer.categoryId === target.content.categoryId`
  - `model` → `answer.id === target.content.id`

### 4.10 `js/game/trialGen.js`

```js
export function levelFeasibility(manifest, level) -> {
  frame: boolean, object: boolean, ok: boolean, reason: string|null
}
export function buildLevelDeck(manifest, level) -> LevelDeck | null
export function createTrialGenerator(manifest, rng) -> {
  next(level, deck): Trial | null
}
```

**`LevelDeck` 是一關的固定素材組**（見 1.7），在該關開始時算一次：

```js
{
  shapes: Array<AssetRef>,   // 長度 level.shapeCount
  objects: Array<AssetRef>,  // 長度 level.objectCount
  targetObjects: Array<AssetRef>, // category 關含指定類別的全部圖片；model 關同 objects
}
```

**兩個陣列的長度通常不相等**（例如第 1 關是 5 與 2），不要假設相同。

- `shapes` = `manifest.shapes` 的前 `shapeCount` 個。
  **直接用 manifest 給的順序，不得自己再排序一次**（`build_manifest.py` 已依
  檔名排好；用 `id` 再排一次，遇到「一個檔名是另一個的前綴」會得到相反順序）。
- `model` 關：`objects` = `level.sourceCategory` 那個類別的**全部**
  `objectCount` 張圖（依檔名排序，不洗牌——洗牌是每題的事）。
- `category` 關：`objects` = `level.sourceCategories` 列出的
  `objectCount` 個類別，**每類取 `cat.images[0]`**（manifest 已依檔名排序，
  同上：不得自己再排一次）；`targetObjects` 則依 `sourceCategories` 順序串接
  每個類別的**全部 `cat.images`**。
- 不可行的關卡回傳 `null`。
- `buildLevelDeck` **不吃 `rng`**：必須是確定性的，同一份素材永遠得到同一個
  deck（1.7 的可比性）。

`Trial` 形如：

```js
{
  type: 'compound',          // 永遠是 'compound'（見 1.4，每題必為複合題）
  levelNo: number,           // 關卡序號，原封不動帶到 stats.record()
  shapeCount: number,
  objectCount: number,
  target: { frame: AssetRef, content: AssetRef },  // 兩者都不得為 null
  shapeItems: Array<AssetRef>,   // deck.shapes 洗牌後的排列，長度 shapeCount
  objectItems: Array<AssetRef>,  // deck.objects 洗牌後的排列，長度 objectCount
  objectRule: 'category' | 'model',
}
```

規則：
- `next()` 把 `deck` 的兩組閥門素材**各自獨立**洗牌成這一題的排列；
  `shapeItems` 與 `objectItems` 的集合必須恆等於 `deck` 對應的集合（見 1.7）。
- `frame` 目標必定在 `shapeItems` 中；`model` 目標必定在 `objectItems` 中。
- `category` 目標從 `targetObjects` 的洗牌袋逐張取用；一袋全部圖片出完以前
  不得重複。目標本身不必出現在 `objectItems`，但它的 `categoryId` 必須在
  四張固定代表圖中恰好有一個對應答案。
- `objectRule` 由 `level` 指定；出題器不得自行挑題型，也不得因為某個規則
  「這次剛好不可行」就換另一個規則出題。
- `deck` 為 `null`（該關不可行）→ `next()` 回 `null`。
- `rng` 是一個 `() => number`（0..1），呼叫端可注入固定種子的產生器以便重現。
  **不得直接呼叫 `Math.random()`。**

`levelFeasibility` 的判斷依 1.6 的表：`frame` 看 `shapes.length >= shapeCount`；
`model` 看 `sourceCategory` 指定的類別存在且圖片數 `>= objectCount`；
`category` 看 `sourceCategories` 的每個類別都存在且陣列長度 `=== objectCount`。

### 4.11 `js/game/stats.js`

```js
export function createStats() -> {
  record({ trialIndex, level, optionCount, valveKind, rule, targetId, answerId,
           correct, settleMs, firstInputMs, slotsRotated }): void,
  rows(): Array<Row>,
  summary(): Summary,
  setDuration(ms): void,
}
```

`setDuration(ms)` 由呼叫端（`dccs.js`）在場次結束或 `destroy()` 時傳入
**模擬遊玩時間**，即 `summary().duration` 的來源。`stats.js` 內部**不得**
自行用牆上時鐘算 duration，連保底值也不行；沒設定過就回 `0`。

`record()` 的參數形成內部逐題紀錄：`level` 是**關卡序號**，
`optionCount` 是**該列這道閥的選項數**——`valveKind === 'shape'` 時填
`trial.shapeCount`，`'object'` 時填 `trial.objectCount`。兩道閥的選項數
通常不同（見 1.5），所以同一題的兩列這個欄位往往不一樣，這是正確的。
**不要加回 `trialType`** —— 每題必為複合題，該欄恆為 `'compound'`、零資訊量。

`Summary` 必須包含且僅包含（欄位名一字不差，對應資料庫欄位）：

```js
{
  frameCorrectCount, frameWrongCount,
  categoryCorrectCount, categoryWrongCount,
  modelCorrectCount, modelWrongCount,
  correct_count, wrong_count, accuracy, duration, stage, levelsPlayed
}
```

- `correct_count = frameCorrectCount + categoryCorrectCount + modelCorrectCount`
- `wrong_count` 同理
- `accuracy = correct_count / (correct_count + wrong_count)`，分母為 0 時給 `0`
- `duration` 毫秒（整數）。**本場的模擬遊玩時間**，算式必須是
  `Math.round(Math.min(track.elapsed, sessionSeconds) * 1000)` —— 兩個部分都
  是必要的：**(a) 不可用牆上時鐘**（分頁切到背景的時間會被算進這個理應為常數
  的欄位）；**(b) 不可直接用 `track.elapsed * 1000`**，要夾上限（固定步長使
  最後一幀必定越過門檻，實測會得到 `600017` 而不是 `600000`）。
  `startTime` / `endTime` 則仍用牆上時鐘記錄真實時間戳。
- `stage` 為本場到達的**最高關卡序號**（1–5）；玩到第五關即為 `5`
- `levelsPlayed` 為走過的**關卡序號**由小到大排序、去重、逗號連接，
  例如 `"1,2,3,4,5"`
- `record()` 收到的 `level` 欄位即**關卡序號**（`levelNo`），由 `track.js` 傳入

> `stage` 是**關卡序號**、不是選項數（選項數 2/3/4/4/5 不嚴格遞增，用它會讓
> 第 3、4 關算出同一個值）。資料庫欄位型別不變，只是填進去的語意是關卡序號。

#### 4.11.1 三個行為時間欄位（不要加回 `rtMs`）

這個遊戲**沒有離散的作答事件**，傳統反應時間無法定義；`rtMs`（目標出生到
判定的存活時間）完全由幾何決定，每列都是同一個常數，**不要把它加回來**。
改用下列三個真的隨玩家行為變動的量：

| 欄位 | 定義 | 為 `null` 的情況 |
|---|---|---|
| `settleMs` | 玩家**最後一次**轉動該閥 → 判定時刻的毫秒數 | 整題沒轉過該閥 |
| `firstInputMs` | 目標出生 → 玩家**第一次**轉動該閥的毫秒數 | 整題沒轉過該閥 |
| `slotsRotated` | 該題內該閥**轉過的格數（整數）** | 不會為 null，沒轉為 `0` |

`settleMs` 最接近反應時間的概念（多早定案）；`slotsRotated` 量到單向閥想測的
規劃能力（轉過頭必須繞一整圈，數值大代表規劃失敗），**必定是整數**
（＝這題對該閥按了幾下），不要補小數點。

`trialIndex` 由 `Track` 維護，複合題的兩次判定共用同一個值，才能在分析時
把「同一題形狀對了但物件錯了」這種規則轉換模式撈出來。

### 4.12 `js/game/track.js`

**一條賽道 = 一個 Track。雙人版之後只要建立兩個 Track、各給一個 viewport
與一組 bindings 即可，因此 Track 內不得出現任何全域狀態或寫死的按鍵。**

```js
export class Track {
  constructor({ manifest, images, input, viewport, rng, stats,
                backgroundKey = 'single',
                sessionSeconds = CONFIG.SESSION_SECONDS })
  update(dt): void
  render(ctx, alpha): void
  setViewport(viewport): void
  get score(): number
  get elapsed(): number
  get currentLevelShapeCount(): number
  get currentLevelObjectCount(): number
  get currentLevelNo(): number
}
```

Track 負責：關卡推進（每 `sessionSeconds / manifest.levels.length` 秒到達
切關門檻；若當時有題目飛行中，須等該題完整離開才正式進下一關，走完最後一關
後停在最後一關）、出題、目標移動、兩道閥的旋轉與判定、✓ 回饋計時、把每次
判定交給 `stats.record()`。

`backgroundKey` 是要從 `images` 取哪一張背景（對應 `manifest.backgrounds` 的
key）。單人模式一律 `'single'`；留這個參數是為了雙人版能改用 `'double'`，
Track 內不得寫死背景。

**`sessionSeconds`**：這一場的長度，預設 `CONFIG.SESSION_SECONDS`，由
`mountDCCS` 的同名選項傳進來。每關時長與 HUD 進度條 **一律用它**，不得直接讀
`CONFIG.SESSION_SECONDS` —— 否則呼叫端縮短場次時關卡步調不會跟著縮，
`duration` 看起來正常但關卡涵蓋度是錯的。

**閥的驅動改成邊緣觸發**（見 1.2 / 4.3 / 4.8）：`update(dt)` 每幀先用
`input.takePresses('rotateShape' | 'rotateObject')` 取出這一幀累積的按下次數，
有幾次就對應 `valve.step(次數)`，然後一律呼叫 `valve.update(dt)` 推進動畫。
**不可以再用 `input.isDown()` 來決定要不要轉**。

**每關的素材只算一次**：關卡切換時（含開場）呼叫
`buildLevelDeck(manifest, level)` 取得該關的固定素材組存起來，
之後這一關的每一題都把同一個 deck 傳給 `trialGen.next(level, deck)`。
**不得每題重算 deck**（那等於每題換素材，違反 1.7）。

出題時把**整個 level 物件**交給 `trialGen.next(level, deck)`。出題當下就要把
`levelNo` 存進 `this._trialLevelNo` 當成「這一題的固定屬性」，判定時一律讀它，
**絕不可在判定當下重新讀當前關卡**。關卡時間門檻若落在題目飛行途中，只能
設定待切換狀態；必須等該題通過兩道閥並完整離開，才切換 level、重建 deck、
生成下一關第一題並由 `dccs.js` 顯示提示。等待題目完成的超時須保留到下一關，
不能歸零。如此使用者按下「繼續」後，畫面只會出現新關卡題目，不會再次看到
上一關最後一題。`currentLevelShapeCount` / `currentLevelObjectCount` /
`currentLevelNo` 只給渲染、HUD 與關卡提示偵測用；**不要再加一個籠統的
`currentLevelOptions`**（兩道閥的選項數不同，那個名字沒有明確語意）。

### 4.13 `js/net/client.js`

```js
export function buildPayload({ lessonId, student, summary }) -> object
export async function submitResult(payload, { url = resolveSubmitUrl() } = {}) -> { ok, detail }
export function listPendingResults() -> Array<{ key, payload }>
export async function flushPendingResults({ url = resolveSubmitUrl() } = {}) -> { attempted, sent, failed }
```

- `buildPayload` 產出的物件結構必須與中介平台的 Unity payload 相同
  （`{ lessonId, data: { grade, caseId, school, currentDay, startTime, endTime,
  mode: 'single', stats: [{apiname, value}, ...] } }`），
  `currentDay` 必須是整數，`startTime` / `endTime` 必須是 Unix **毫秒整數**，
  不得把本機顯示用的 `{ iso, ms }` 物件放進正式 `data`。
  `stats` 至少包含 5 個核心：`DCCS_correct` / `DCCS_wrong` / `DCCS_accuracy` /
  `DCCS_duration` / `DCCS_stage`，再附上 6 個專屬欄位
  （`DCCS_frameCorrectCount` 等）與 `DCCS_levelsPlayed`。
  所有 DCCS 專屬欄位都必須照送；中介平台目前若尚未寫入這些欄位，可以忽略，
  但遊戲端不得因此省略。
- 回傳值**只能**包含中介平台實際收到的 `{ lessonId, data }`；不得混入
  `sessionId`、`seed`、`rows`、`summary`、`warnings` 或 `notes`。本機 TXT
  直接保存這個回傳值，因此 TXT 的欄位和值必須與送出的 request body 相同。
- `submitResult` 的**預設**目標由 `js/net/apiBase.js` 的 `resolveSubmitUrl()`
  決定（見 4.13b）。**本模組內不得寫死任何外部網址**；要送到別處由呼叫端用
  第二個參數明示覆寫（`mountDCCS` 的 `submitUrl` 會傳進來）。
  送失敗時把整包 JSON 存進 `localStorage`（key 前綴 `dccs_pending_`）
  並回傳 `ok: false`。
- `flushPendingResults` 重送所有暫存成績，**成功的才刪掉**，失敗就整批留到
  下次；遇到第一個失敗即停止（多半是伺服器仍未就緒，continue 也只是白試）。
  它**不得**走 `submitResult`——那支失敗時會再寫一筆新的暫存，重送一旦失敗
  會讓暫存無限增生。`listPendingResults` 順便清掉 JSON 已損毀的殘留。
- 暫存 key 為 `dccs_pending_<毫秒>_<亂數>`；亂數是必要的，雙人模式兩位玩家
  會在同一毫秒送出，只用時間戳會互相覆蓋。

### 4.13b `js/net/apiBase.js`

```js
export function resolveApiBase() -> string    // 不含結尾斜線
export function resolveSubmitUrl() -> string
```

單人與雙人**共用同一套端點解析**，任何一邊都不得自己寫死網址。
`resolveSubmitUrl()` 的優先序：

1. `window.DCCS_SUBMIT_URL`——整支端點覆寫。
2. `window.API_BASE_URL`——只換 API 前綴，端點仍是 `<base>/sessions`。
   與中介平台前端 `frontend/js/api.js` 同名同義。
3. 同源：`${window.location.origin}/api`。

第 3 條是關鍵。前端由中介平台後端一併提供（`backend/main.py` 把
`frontend/` 掛在 `/app`），API 必然與頁面同源，因此**本模組不得出現任何
硬寫的網域或 port**——硬寫過一次正式站網址，結果是本機測雙人把成績灌進
正式庫。同源也讓 CORS 完全不需要設定。

### 4.13c `js/lobby.js`

```js
export function readLobbyPlayer(slot) -> object | null
export function readLobbySession() -> { mode, players } | null
export async function resolveCurrentDay(player) -> number
export function returnToLobby() -> void
```

與中介平台大廳（`frontend/games.html`）的銜接。大廳與本遊戲**同源**，學生
登入後由 `frontend/js/app.js` 寫進 `sessionStorage` 的資料這裡直接讀得到，
因此大廳不必透過 URL 或 postMessage 傳遞受試者資料，只需把使用者導過來。

- 讀的鍵：`student{1,2}_key`（`G1_S03` 形式）、`student{1,2}_school`、
  `student{1,2}_token` / `token`、`game_mode`。
  `studentKey` **只切第一個底線**，因為 caseId 本身可能含底線。
- `game_mode` 為 `double` 且第二位玩家存在，才回 `mode: 'double'`；否則
  一律 `'single'`。兩位玩家**可以屬於不同 school**（school 是學生身分的
  一部分，見 `backend/CONTEXT.md`），故各自帶各自的。
- `resolveCurrentDay` 打 `GET /api/students/{key}/sessions?school=...`
  推導施測日：今天已有場次→沿用其 `currentDay`（同一施測日的 5 款遊戲
  共用一個值）；否則歷史最大值 +1；無紀錄→1。後端存的是 UTC naive，
  而施測日是**本地日曆**的一天，故比對前先轉回本地時區。
- **推導失敗一律 `throw`，不得默默猜值**——`currentDay` 猜錯會污染研究
  資料，寧可退回讓現場人員手動填。雙人時兩位算出來不一致也視為失敗。

這是權宜做法；正解是後端擁有此值，見 `docs/dccs-lobby-handoff.md`。

### 4.14 `js/main.js`（**獨立執行用的殼**）

**真正的進入點是 `js/dccs.js`（4.15）**；`main.js` 只是「不靠 main 專案也能
自己跑一場」的殼，只負責蒐集受試者資料，遊戲本身一行都不做：

1. 解析 URL query：`grade`、`caseId`、`school`、`currentDay`、`seed`。
   缺前四項任何一項則顯示 `index.html` 裡的輸入表單，填完才開始。
2. 呼叫 `mountDCCS({ container, student, seed })`，`await handle.done`。
3. 拿到結果後不做任何額外處理（成績由遊戲自己送出，見 4.15）。

**`main.js` 不得再包含**：canvas 建立、loop、Track、stats、buildPayload、
submitResult、載入中／標題／關卡提示／結算／錯誤畫面 —— 這些全部搬進 `dccs.js`
與 `ui/overlays.js`，否則 main 專案掛載時就拿不到它們。

### 4.15 `js/dccs.js`（**公開 API，main 專案唯一該碰的檔**）

```js
export const DCCS_DEFAULT_BINDINGS = {
  rotateShape:  ['ArrowLeft',  'KeyA'],
  rotateObject: ['ArrowRight', 'KeyD'],
};

export function mountDCCS(options) -> DCCSHandle
```

#### options

| 欄位 | 預設 | 說明 |
|---|---|---|
| `container` | **必填** | `HTMLElement`。遊戲把 canvas 與所有畫面層建在這裡面 |
| `student` | **必填** | `{ grade, caseId, school, currentDay }`。四項缺一即 `throw`（**不再自己彈表單**，那是 main 的事） |
| `seed` | `Date.now()` | 亂數種子 |
| `lessonId` | `'lesson_DCCS'` | 帶進 payload |
| `sessionSeconds` | `CONFIG.SESSION_SECONDS` | 必須是正有限數；每關時長為 `sessionSeconds / 關卡數` |
| `bindings` | `DCCS_DEFAULT_BINDINGS` | 交給 `createInput`，雙人版用 |
| `manifestUrl` | `new URL('../manifest.json', import.meta.url).href` | |
| `assetBase` | `new URL('../', import.meta.url).href` | 見 4.4 |
| `autoStart` | `false` | `true` 則不顯示標題畫面；每關開始提示仍會顯示 |
| `showResultScreen` | `true` | `false` 則結束後不顯示結算畫面（由 main 自己畫） |
| `submit` | `true` | 是否自己送出成績（**預設照舊自己送**） |
| `submitUrl` | `resolveSubmitUrl()` | 傳給 `submitResult`，見 4.13b |
| `showTutorial` | `true` | 開始前顯示單頁操作說明（見 4.16b）；`autoStart` 時一律不顯示 |
| `onPhase` | `null` | `(phase) => void`，phase 為 `'loading' \| 'tutorial' \| 'title' \| 'level-prompt' \| 'playing' \| 'submitting' \| 'done' \| 'error'` |

#### DCCSHandle

```js
{
  done: Promise<DCCSResult>,   // 一定會 settle：正常結束、destroy()、或錯誤
  destroy(): void,             // 停迴圈、拆 listener、清空 container
  get elapsed(): number,       // 已遊玩的模擬秒數
}
```

```js
DCCSResult = {
  aborted: boolean,            // destroy() 造成的提前結束
  sessionId: string,
  seed: number,
  summary: object,             // stats.summary()
  rows: Array<object>,         // stats.rows()
  payload: object,             // buildPayload() 的結果；固定只有 { lessonId, data }
  warnings: Array<string>,
  notes: Array<string>,
  submitted: { ok, detail } | null,   // submit: false 時為 null
}
```

#### 硬性要求

- **零全域狀態**。所有 DOM 一律建在 `container` 內、用 `container.querySelector`
  或直接持有節點參照取得，**不得出現 `document.getElementById`**。
  同一頁同時掛兩個實例（＝雙人版）必須各自獨立運作、互不影響。
- 畫布尺寸跟著 **`container`** 走（`ResizeObserver`），不是 `window.innerWidth`；
  `devicePixelRatio` 要處理；遊戲以 16:9 置中，其餘留黑邊。
- `destroy()` 必須可重入（呼叫兩次不炸），且要 `loop.stop()`、
  `input.destroy()`、`resizeObserver.disconnect()`、移除標題畫面那個
  等空白鍵的 `keydown` listener、清空 `container`。
  `destroy()` 若在結束前呼叫，`done` resolve 成 `aborted: true` 的結果
  （成績照樣算出來，但 `submitted` 為 `null`，**不送出**）。
- `duration` 的夾制：`Math.round(Math.min(track.elapsed, sessionSeconds) * 1000)`
  —— 上限用**這一場的** `sessionSeconds`，不是 `CONFIG.SESSION_SECONDS`（見 4.11）。
- 例外一律讓 `done` reject 之外**同時**顯示錯誤畫面；main 兩種方式都接得到。

main 端的實際用法範例見 `README.md` 第 3 節。

### 4.16 `js/ui/overlays.js`

```js
export function createOverlays(container) -> {
  showLoading(detail), showTitle(meta), showLevelPrompt(levelNo) -> Promise<void>,
  showResult(summary, statusText),
  setResultStatus(text), showError(message), hideAll(), destroy()
}
```

- 在 `container` 內建出載入中／標題／關卡提示／結算／錯誤五個畫面層，**不含輸入表單**
  （表單是 `index.html` 那個殼的，見 4.14）。
- 每一關（包含第 1 關）開始前顯示關卡提示。版面採橘黃漸層背景、白色大圓角
  卡片、上方藍色「第 N 關」標籤、中央「準備開始第 N 關！」文字，以及下方
  綠色「繼續」按鈕。`showLevelPrompt()` 在按鈕按下前不得 resolve。
- 關卡提示顯示期間，loop 可以繼續 render，但不得推進 `Track.update()`；因此
  `elapsed`、HUD 進度、目標位置與 `duration` 都不包含等待提示的時間。提示期間
  誤觸的形狀／物件操作鍵必須清掉，不可在按下繼續後補轉。
- 樣式由本模組注入一個 `<style>`（以 `data-dccs-style` 屬性做只注入一次的
  防護），class 一律 `dccs-` 前綴，**不得使用 id 選擇器**，
  才不會跟 main 的樣式互撞。`frontend/dccs/css/style.css` 只留殼（body、表單）的樣式。

---

### 4.16b 操作說明（`overlays.showTutorial`）

標題畫面之前顯示的**單一頁面**說明，內容由 `dccs.js` 的
`buildTutorialContent()` 依 `manifest` 產生，圖用**真實素材**（形狀閥前 3 個
shape、物件閥第一個類別的前 3 張），不另外畫示意圖。

版面做成上下兩張操作卡，對應遊戲畫面裡形狀閥在上、物件閥在下的位置。
每張卡將控制對象、可用按鍵、「按一下轉一格」與實際素材分開呈現；作答時機與安心
提示另用訊息區塊呈現，不把所有文字擠成一段。教學面板最寬 900px，並限制高度、
允許捲動，確保小螢幕上的文字與圖片仍有足夠尺寸。

**說明只講操作，絕對不得講答題規則。** 第 1.4 節已經定了「規則不顯示給
玩家，要自己從畫面推」——推論規則、以及規則改變時能不能跟著轉，正是 DCCS
要測的東西。把「形狀閥選相同形狀」或「這關物件閥是 model 還是 category」
寫進說明，等於把受測項目直接告訴受試者，資料就失去意義。同理，**不得放
實際遊玩的錄影**：示範比文字更有效地把規則教出去。

因此內容限於：兩排各自用哪些按鍵、按一下轉一格、穿過當下停在中央的即為
作答、答錯不扣分也不重來。

教學畫面不放大型開始按鈕；鍵盤收 `Enter`、`NumpadEnter` 或空白鍵後直接
開始，不再停留於另一個標題畫面。方向鍵仍只用於遊戲內轉動選項。監聽器在
settle 時解除，不得殘留到遊戲中。

### 4.17 離開頁面保護

場次進行中（`level-prompt` / `playing` / `submitting`）掛上 `beforeunload`，
離開頁面時由瀏覽器跳確認。結束（`done`）或 `destroy()` 時解除——`emitPhase('done')`
**必須**在 `settleDone()` 之前呼叫，否則從大廳進場的場次跑完自動導回大廳時
會誤跳確認框。

兩個瀏覽器限制：提示文字**不可自訂**；使用者必須先與頁面互動過才會觸發
（標題畫面要按空白鍵，此條件天然成立）。

另：標題畫面的空白鍵要 `preventDefault()`，否則遊戲嵌在別人的頁面裡時
會整頁捲動。

## 5. `manifest.json` 格式

由 `tools/build_manifest.py` 產生，寫到 `frontend/dccs/manifest.json`。

```json
{
  "generatedAt": "2026-09-09T12:00:00Z",
  "backgrounds": {
    "single": "assets/Single.png",
    "double": "assets/Double.png"
  },
  "shapes": [
    { "id": "shape/未命名的作品 9", "src": "assets/shape/%E6%9C%AA...png" }
  ],
  "categories": [
    {
      "id": "2",
      "imageCount": 2,
      "images": [
        { "id": "2/未命名的作品", "src": "assets/2/...png", "categoryId": "2" }
      ]
    }
  ],
  "levels": [
    { "index": 0, "levelNo": 1, "shapeCount": 5, "objectCount": 2,
      "objectRule": "model", "sourceCategory": "2", "playable": true, "reason": null },
    { "index": 2, "levelNo": 3, "shapeCount": 2, "objectCount": 4,
      "objectRule": "category", "sourceCategories": ["2", "3", "4", "5"],
      "playable": true, "reason": null },
    { "index": 4, "levelNo": 5, "shapeCount": 2, "objectCount": 5,
      "objectRule": "model", "sourceCategory": "5", "playable": true, "reason": null }
  ],
  "warnings": []
}
```

（上面只列出五關中的三關示意欄位形狀；實際 `levels` 是五項，**目前五關全部
`playable: true`、`warnings` 為空**。素材缺口時該關會變成
`"playable": false, "reason": "model source category \"6\" not found"`，
並在 `warnings` 多一行 `level 5 unplayable (model source category \"6\" not found)`。）

- `src` 的每個路徑片段必須 URL-encode（檔名含中文、空白與括號）。
- `src` 是**相對路徑**（`assets/…`，**開頭不可以有 `/`**）。實際網址由前端以
  `new URL(src, assetBase)` 算出（見 4.4）；絕對路徑在遊戲被掛在子目錄時會失效。
- `categories` 依**類別 id** 排序（字串排序）；`imageCount` 就是 `images.length`。
  類別本身**不帶 `optionCount`** —— 它能支援多大的 `model` 題由 `imageCount`
  決定，與關卡無關（見 1.5）。
- `levels` **完全照 `frontend/dccs/levels.json` 的順序**，不排序、不去重，
  並原封不動帶上該關的 `shapeCount`、`objectCount`，以及
  `sourceCategory`（model 關）或 `sourceCategories`（category 關）。
- `playable` 為 `false` 時 `reason` 說明缺什麼，並在 `warnings` 寫一行
  （格式見 1.6）；`playable` 為 `true` 時 `reason` 為 `null`。
- 產生器要在終端印出一張各關可行性表格（關卡序號、形狀閥選項數、
  物件閥選項數、規則、素材來源、frame 是否可行、object 是否可行、
  是否 playable），
  不可行的關卡另外把 `WARN:` 那幾行印出來。

### 5.1 `frontend/dccs/levels.json` 格式（人工維護的關卡設計表）

**這是關卡的唯一來源**，`build_manifest.py` 讀它，不從素材掃描產生關卡。

```json
{
  "levels": [
    { "shapeCount": 5, "objectCount": 2, "objectRule": "model",    "sourceCategory": "2" },
    { "shapeCount": 5, "objectCount": 3, "objectRule": "model",    "sourceCategory": "3" },
    { "shapeCount": 2, "objectCount": 4, "objectRule": "category", "sourceCategories": ["2", "3", "4", "5"] },
    { "shapeCount": 2, "objectCount": 4, "objectRule": "model",    "sourceCategory": "4" },
    { "shapeCount": 2, "objectCount": 5, "objectRule": "model",    "sourceCategory": "5" }
  ]
}
```

**這就是 `frontend/dccs/levels.json` 現在的內容**（＝ 1.5 的關卡表），不是範例值。

- `levelNo` 不寫在檔案裡，由陣列順序決定（第一項就是第 1 關）。
- `shapeCount` 與 `objectCount` **是兩個獨立的數字**，不要假設相等
  （見 1.5：影片裡它們是反向走的）。
- `objectRule` 只允許 `"model"` 或 `"category"`。
- `model` 關必須有 `sourceCategory`（一個類別 id，即 `assets/` 底下的
  資料夾名稱）；`category` 關必須有 `sourceCategories`（類別 id 陣列，
  長度必須等於 `objectCount`）。
- 上列任一項缺漏、型別錯誤、或 `sourceCategories` 長度對不上 `objectCount`，
  `build_manifest.py` 要**直接報錯離開**（回傳非 0），不要產出半套 manifest。
  這跟「素材還沒補齊」不同：後者是 `playable: false` + `WARN`，遊戲照跑。
- **`sourceCategory` 指到不存在的類別不是設定錯誤**，而是素材還沒補
  （例如把某關改成 `"6"`，而 `assets/6/` 不存在），要走
  `playable: false` + `WARN` 這條路。目前五關指到的類別都存在。

> 素材來源寫在這裡、而不是靠資料夾名稱推導，是刻意的：改素材對應只要改這個檔，
> 而且新增一個類別資料夾**不會**憑空多出一個關卡。

## 6. 成績去向

成績 `POST` 到中介平台的 `POST /api/sessions`（見 `backend/routers/sessions.py`），
由後端寫進 MariaDB。端點解析見 4.13b。

送不出去時整包 JSON 留在瀏覽器 `localStorage`（key 前綴 `dccs_pending_`），
下次開場由 `flushPendingResults()` 重送（見 4.13）。**不再有本機 txt 落地**
——先前那支 `serve.py` 已整併進中介平台後端，落地檔在雲端部署上也是暫存性質，
留著只會讓人誤以為資料安全。

payload 的欄位與型別要求見 4.13；遊戲端須完整輸出全部 12 筆 stats，平台暫時
不寫入 DCCS 專屬欄位也沒關係。

## 7. 前端怎麼被提供

由中介平台後端一併提供，**不另外起靜態伺服器**：`backend/main.py` 結尾把
repo 的 `frontend/` 以 `StaticFiles(html=True)` 掛在 `/app`。

- 入口 `/app/`（登入頁）；大廳 `/app/games.html`；本遊戲
  `/app/dccs/index.html`、`/app/dccs/double.html`。
- 掛載點固定為 `/app`，**不得改掛在 `/`**：那會遮蔽 `/api/*`、`/health`、
  `/demo`，也會跟日後新增的 API 路由相撞。
- **只掛 `frontend/` 一個目錄**。後端原始碼與 `.env` 不在其中，因此不需要
  任何黑名單——白名單本來就比「伺服整個 repo 再擋掉 backend/」可靠。
- 因為同源，瀏覽器端不需要任何 CORS 放行。

啟動：

```bash
cd backend
uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001
```

## 8. 驗收條件

**素材現況：五關全部可玩，沒有缺口，不需要補任何素材。**

### 基本

- `python3 tools/build_manifest.py` 產出 `frontend/dccs/manifest.json`，可行性表格顯示
  **五關全部 playable**、`warnings` 為空。
- `manifest.levels` 的五項依序是（`levelNo`, `shapeCount`, `objectCount`, 規則, 素材）：
  `(1,5,2,model,"2") (2,5,3,model,"3") (3,2,4,category,[2,3,4,5]) (4,2,4,model,"4") (5,2,5,model,"5")`
- 一場結束後 `duration` 為 `600000`、`stage` 為 `5`、`levelsPlayed` 為 `1,2,3,4,5`。

### 素材不足時要能優雅降級（不改 `assets/`，用複本驗）

把 `assets/`、`tools/`、`frontend/dccs/levels.json` 複製到暫存目錄，在**複本**裡
把某一關的 `sourceCategory` 改成不存在的類別（例如 `"9"`），重跑
`build_manifest.py`：該關要被標成 `playable: false`、寫出
`WARN: level N unplayable (...)`，其餘關卡照常，且**遊戲跑起來時該關空過、
不當機、不出題、不記錄**，`levelsPlayed` 少掉那一關。

### 兩道閥的選項數必須各自獨立（1.5 的核心）

- 第 1、2 關的形狀閥有 **5** 個選項，物件閥分別是 2、3 個。
- 第 3、4、5 關的形狀閥只有 **2** 個選項，物件閥分別是 4、4、5 個
  （**不是** 4、5、6，見 1.5）。
- 逐題紀錄中，同一題的 `shape` 列與 `object` 列的「選項數」欄**通常不同**，
  且各自等於該關設計表的 `shapeCount` / `objectCount`。
  兩列的選項數如果永遠相等，就是沒有把兩個數字拆開，是錯的。

### 每關開始提示

- 第 1–5 關開始前都必須各顯示一次提示，按「繼續」後才開始或恢復遊戲。
- 提示上顯示的關卡號必須與接下來的 HUD 關卡一致。
- 切關提示出現前，上一關最後一題必須已通過兩道閥並離場；按「繼續」後畫面
  上的目標必須是新關卡第一題，且仍停在 `Z_SPAWN`、尚未被提示期間推進。
- 提示停留時 `handle.elapsed` 不得增加，目標與閥門不得移動。
- 提示停留多久都不得改變最終 `duration = 600000` 或各關實際遊玩秒數。
- `autoStart: true` 只略過總標題畫面，不得略過關卡提示。

### 每一關的素材必須固定（1.7 的核心）

- 同一關之內，所有題目的 `objectItems` **集合**完全相同（順序可以不同），
  `shapeItems` 亦然。跑完一場後逐題檢查，任何一關出現集合不一致就是錯的。
- 第 1 關的 `objectItems` 集合恆等於 `assets/2/` 的 2 張圖；
  第 2 關恆等於 `assets/3/` 的 3 張；第 3 關恆等於四個類別各一張；
  第 4 關恆等於 `assets/4/` 的 4 張；第 5 關恆等於 `assets/5/` 的 5 張。
- 第 3 關的四張 `objectItems` 仍固定為四類別各自依檔名排序的第一張；目標
  `content` 則必須涵蓋四類別底下的全部圖片。以目前共 14 張素材而言，連續
  14 題的 `target.content.id` 必須恰好各出現一次，第 15 題才可開始重複。
- 第 1、2 關的 `shapeItems` 集合恆等於前 5 個形狀；
  第 3、4、5 關恆等於前 2 個形狀。
- 同一關內**排列順序要真的有在變**（不是每題都一樣的順序）。

### 閥的操作（1.2 的核心）

- 按一下方向鍵，閥**平滑滑動整整一格後停住**，`theta` 回到整數，
  選項精確對齊賽道中央。
- **按住不放只轉一格**（瀏覽器的 `keydown` 自動重複必須被擋掉）。
- 連按 3 下會依序轉 3 格，一下都不吞。
- 判定時取到的 `answer()` 永遠是某個明確的選項，不會落在兩格之間。
- `slotsRotated` 是整數，且等於該題對該閥的有效按鍵次數。

### 純繪製常數不得影響任何資料（第 2 節的核心）

- `VANISHING_Y` / `BASE_Y` / `CAM_DEPTH` / `SPRITE_BASE` / `TARGET_PERSPECTIVE`
  / `SLOT_LANE_SPACING` / `SLOT_RENDER_LIMIT` 全部只影響畫面。
  驗法：固定 seed 跑完一整場、把 `summary` 與**每一列** `rows` 存下來，
  改動這些常數後重跑，兩份輸出必須 **byte-identical**。
- `TARGET_PERSPECTIVE` 設成 `1` 時，`targetSizeAt(z, vp)` 必須與
  `project(z, 0, vp).size` **完全相等**（浮點也要相等）。這是回歸的錨點。
- 反過來，`Z_SPAWN` / `TARGET_SPEED` **會**影響資料（它們決定每題長度），
  動到它們一定要重驗 `levelsPlayed` 與每關題數。

### 版面：單側佇列（2.2 的核心）

- 形狀閥的選項**只出現在賽道中央與中央右側**，物件閥**只出現在中央與左側**。
  任何一幀出現「形狀閥有選項在中央左側超過半格」就是錯的（滑出中央那半格
  的過渡除外）。
- 靜止時畫面上的可見數量：第 1、2 關形狀閥 3 個、第 3–5 關形狀閥 2 個；
  物件閥五關**一律 2 個**。
- 靜止時中央那一個的 `lane` 精確為 `0`，且它就是 `answer()`。
- 轉動時 `lane` 連續變化，唯一的不連續是 `off` 由 `-0.5` 環繞到 `N-0.5`
  （相鄰兩幀的 `lane` 差在此處以外不得超過
  `dt / ROT_SEC_PER_SLOT * SLOT_LANE_SPACING + ε`）。
- 這一節可以在 Node 裡直接對 `Valve.slots()` 斷言，不需要瀏覽器。

### API 化（4.15 的核心）

- `js/dccs.js` 之外的任何遊戲模組**都不再出現** `document.getElementById`、
  `window.innerWidth`、`window.innerHeight`，以及開頭為 `/` 的資產路徑
  （`grep` 驗證，`main.js` 這個殼與 `index.html` 不在此限）。
- 同一頁掛**兩個** `mountDCCS` 實例（不同 container、不同 `bindings`），
  兩邊都能各自遊玩、互不影響；其中一個 `destroy()` 之後另一個照常運作。
- `destroy()` 後：`container` 為空、鍵盤事件不再有任何反應、
  `done` resolve 成 `aborted: true` 且 `submitted` 為 `null`。
- 把 `frontend/dccs/` 整包放到伺服器的子路徑下（例如 `/sub/frontend/dccs/index.html`）仍然
  載得到 manifest 與素材（相對路徑，見 4.4 / 第 5 節）。
  驗證用複製的方式做，**不得移動或改動 `assets/`**（第 0 節）。
- `sessionSeconds: 60` 跑完一場，`duration` 精確為 `60000`，
  **且 `levelsPlayed` 為 `1,2,3,4,5`**（每關 12 秒）。
  只驗 `duration` 是不夠的 —— 關卡步調沒跟著縮短時 `duration` 照樣正確，
  但 `levelsPlayed` 只有 `1`。

  > **不要把這一條改成 `sessionSeconds: 30`**：一題固定要 `38 / 7 ≈ 5.43` 秒，
  > 30 秒場次每關只有 6 秒，最後一關那題來不及判定就散場，`levelsPlayed`
  > 必然少一關。這是物理常數決定的，不是 bug，不要去動 `Z_SPAWN`／
  > `TARGET_SPEED` 來湊。實測門檻 45 秒，取 60 秒留餘裕。

### 其他

- 後端啟動後（見第 7 節），瀏覽
  `http://127.0.0.1:5001/app/dccs/index.html?grade=G1&caseId=S03&school=KMU&currentDay=1&seed=42`
  可以進入遊戲並實際遊玩；從 `/app/games.html` 點 DCCS 亦可（見 4.13c）。
- 逐題紀錄的每一個 `#` 都恰好有兩列（`shape` 與 `object` 各一），
  且 `object` 那列的規則等於該關設計表的 `objectRule`：
  第 1、2、4、5 關為 `model`，第 3 關為 `category`。
- 關卡時間門檻落在題目飛行途中時，須先完成該題的 shape/object 兩列紀錄，
  等目標離開後才切關；下一關提示按下「繼續」後不得出現上一關最後一題。
- 每題仍要以**出題當下**的關卡固定屬性進行判定（見 4.12）。
- `frameCorrectCount + frameWrongCount` 等於總題數。
- 多一個語意類別**不會多出關卡**。驗證時**不得真的去動 `assets/`**
  （見第 0 節，它是唯讀的）——把 `assets/`、`tools/`、`frontend/dccs/levels.json`
  複製到暫存目錄，在**複本**裡加一個資料夾再跑 `build_manifest.py`，
  確認 `categories` 多一個而 `levels` 數量不變。
- `projection.js` 與 `rules.js` 可用 `node --test` 或簡單腳本單獨驗證。
