## 目前寫在本地SQL lite 之後將api.js中
const API_BASE_URL = "http://127.0.0.1:5002";
改為 const API_BASE_URL = "https://attention-lesson-plan-transfer-data.zeabur.app";

cd frontend/DAT_double
python local_sqlite_server.py

cd "\backend"
uv run uvicorn main:app --reload --host 127.0.0.1 --port 5001

cd "\frontend"
python -m http.server 5500

## 開 http://127.0.0.1:5500/games.html

ctrl+F12 console
sessionStorage.setItem('game_mode', 'double');
sessionStorage.setItem('student1_key', 'G1_S03');
sessionStorage.setItem('student1_school', 'KMU');
sessionStorage.setItem('student2_key', 'G1_S04');
sessionStorage.setItem('student2_school', 'KMU');

## 重載入畫面至雙人即可藉由畫面跳轉至頁面5:Dat_double.html

在學姊的games.html
新增
   const GAME_PAGES = {
        5: "DAT_double\\DAT_double.html", // DAT 雙人版
      };
連接進去