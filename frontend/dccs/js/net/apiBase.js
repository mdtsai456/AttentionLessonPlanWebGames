// 成績送出端點的解析（單人與雙人共用同一套規則）。
//
// 前端由中介平台後端一併提供（FastAPI 把 frontend/ 掛在 /app，見
// backend/main.py），所以 API 一律與目前頁面同源——不需要硬寫任何網址，
// 也不會有 CORS 問題。本機、正式站、之後換網域都不用改這支檔案。
//
// 兩個覆寫用的全域變數，都要在載入本檔案「之前」設定：
//   - window.DCCS_SUBMIT_URL：整支端點覆寫（最優先）。
//   - window.API_BASE_URL：只換 API 前綴，端點仍是 `<base>/sessions`。
//     與中介平台前端 frontend/js/api.js 同名同義；前端若哪天改成獨立部署、
//     與後端不同網域，設這個即可。

const API_PATH_PREFIX = '/api';

/** 中介平台 API 的前綴（不含結尾斜線）。 */
export function resolveApiBase() {
  const override =
    typeof window !== 'undefined' ? window.API_BASE_URL : null;
  if (override) return String(override).replace(/\/+$/, '');

  return `${window.location.origin}${API_PATH_PREFIX}`;
}

/**
 * 成績要 POST 到哪裡。優先序：
 * window.DCCS_SUBMIT_URL > window.API_BASE_URL + '/sessions' > 同源 /api/sessions。
 * @returns {string}
 */
export function resolveSubmitUrl() {
  const override =
    typeof window !== 'undefined' ? window.DCCS_SUBMIT_URL : null;
  if (override) return String(override);

  return `${resolveApiBase()}/sessions`;
}
