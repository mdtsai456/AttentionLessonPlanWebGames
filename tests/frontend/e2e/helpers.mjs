// E2E 共用：登入狀態與請求記錄。
export const HOME_URL = /\/Home\/index\.html$/;

// 欄位同 Home/app.js 的 storeStudentSession（單人登入）。
export const STUDENT = {
  user_role: "student",
  login_role: "student",
  game_mode: "single",
  token: "student-token",
  student1_token: "student-token",
  student1_key: "G9_S99",
  student1_case: "S99",
  student1_grade: "G9",
  student1_school: "TEST",
  student1_day: "3",
  grade: "G9",
  caseId: "S99",
  school: "TEST",
  current_day: "3",
  currentDay: "3",
};

// 欄位同 Home/app.js 的 storeTeacherSession。
export const TEACHER = {
  user_role: "teacher",
  login_role: "teacher",
  token: "teacher-token",
  teacher_id: "1",
  teacher_name: "測試",
  teacher_school: "TEST",
};

/** 先開 Home，再把登入資料寫進 sessionStorage，模擬從 Home 登入後的狀態。 */
export async function loginAs(page, session) {
  await page.goto("Home/index.html");
  await page.evaluate((values) => {
    sessionStorage.clear();
    Object.entries(values).forEach(([key, value]) => sessionStorage.setItem(key, value));
  }, session);
}

/**
 * 攔截所有非 GET 請求：/api/sessions 回假的 201，其他一律擋掉。
 * 回傳的陣列會記錄每一筆請求與 JSON body。
 * 注意：攔截請求會讓 Chrome 停用 bfcache，bfcache 測試不能用。
 */
export async function recordWrites(page) {
  const writes = [];
  await page.route("**/*", (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.continue();
    let body = null;
    try {
      body = JSON.parse(request.postData() || "null");
    } catch {}
    writes.push({ method: request.method(), url: request.url(), body });
    if (/\/api\/sessions$/.test(request.url())) {
      return route.fulfill({ status: 201, contentType: "application/json", body: '{"sessionId":1}' });
    }
    return route.abort();
  });
  return writes;
}
