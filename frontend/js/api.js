// API 前綴：本前端由中介平台後端一併提供（FastAPI 把 frontend/ 掛在 /app，
// 見 backend/main.py），所以 API 一律與目前頁面同源——不需要猜 port，也不需要
// 硬寫任何網域。本機、正式站、換 port、換網域都不用改這支檔案，CORS 也免設。
//
// 先前這裡把本機 port 寫死成 5001，結果用 `fastapi dev`（預設 8000）起服務時，
// 登入請求會打到空的 5001，畫面只顯示「登入失敗」，看起來像帳密錯誤。
//
// 前端若哪天改成獨立部署、與後端不同網域，在載入本檔案「之前」設定
// `window.API_BASE_URL` 即可（例如在 index.html 加一段
// `<script>window.API_BASE_URL = "https://...";</script>`），不用改這裡。
function resolveBaseUrl() {
  if (window.API_BASE_URL) return String(window.API_BASE_URL).replace(/\/+$/, "");
  return `${window.location.origin}/api`;
}

const BASE_URL = resolveBaseUrl();

// 帳密登入後端每支受保護的 API 都要帶 Authorization: Bearer <token>
// （見 docs/adr/0004-teacher-student-password-login.md）。這裡統一讀
// sessionStorage 的 "token"：老師登入、學生單人登入都存在這個共用鍵，
// 因為同一個分頁同一時間只會走其中一種角色的畫面（dms.html 只給老師、
// games.html 只給學生），不會互相踩到。雙人模式的兩個學生 token 另外存在
// student1_token / student2_token，不經過這支共用的驗證 fetch。
function authHeaders() {
  const token = sessionStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 收到 401 代表 token 不存在／過期——清掉本地登入狀態，導回登入頁重新登入。
// 只用在「已登入後」的請求；登入端點本身回 401 是正常的「帳密錯誤」，不走這條路。
function handleUnauthorized() {
  sessionStorage.clear();
  window.location.href = "index.html";
}

async function authedFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("請重新登入");
  }
  return res;
}

export const API = {
  // 靜態遊戲清單（公開，遊戲大廳用）
  async getGames() {
    const res = await fetch(`${BASE_URL}/games`);
    if (!res.ok) throw new Error("取得遊戲清單失敗");
    const data = await res.json();
    return data.games || [];
  },

  // --- 登入 ---
  // 登入表單只有「帳號＋密碼」兩欄，沒有選場域這一步：帳號是後端指派的全域唯一
  // 登入帳號（跟老師姓名／studentKey 是分開的兩回事），見 docs/adr/0004。

  // 老師登入：成功回 {token, teacherId, teacherName, school}；
  // 失敗（帳密錯）回傳 null，呼叫端自己顯示畫面上的錯誤文字（不要用 alert()）。
  async teacherLogin(account, password) {
    const res = await fetch(`${BASE_URL}/auth/teacher/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password }),
    });
    if (!res.ok) return null;
    return await res.json();
  },

  // 學生登入：成功回 {token, studentKey, grade, caseId, school}；失敗回 null。
  async studentLogin(account, password) {
    const res = await fetch(`${BASE_URL}/auth/student/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, password }),
    });
    if (!res.ok) return null;
    return await res.json();
  },

  // 登出：best-effort，呼叫端不用等這支成功才清本地狀態。
  // 不帶 token 時登出目前這個分頁的主要身份（sessionStorage 的 "token"）；
  // 雙人模式兩位學生各有自己的 token，games.js 會分別傳入 token 呼叫兩次。
  async logout(token) {
    const headers = token ? { Authorization: `Bearer ${token}` } : authHeaders();
    try {
      await fetch(`${BASE_URL}/auth/logout`, { method: "POST", headers });
    } catch (e) {
      // 網路錯誤也沒關係，反正呼叫端接著就會清 sessionStorage、導回登入頁。
    }
  },

  // --- 老師專用（須登入） ---

  // 4. 登入中的老師名下所有學生（取代舊的 getStudentsByTeacher）
  async getMyStudents() {
    const res = await authedFetch("/me/students");
    if (!res.ok) throw new Error("取得學生名冊失敗");
    return await res.json();
  },

  // 5. 取得特定學生的核心總覽報表 (DMS 核心)
  async getStudentReport(studentKey, school) {
    const res = await authedFetch(
      `/students/${encodeURIComponent(studentKey)}/report?school=${encodeURIComponent(school)}`
    );
    if (!res.ok) throw new Error("調取評測總覽失敗");
    return await res.json();
  },
};
