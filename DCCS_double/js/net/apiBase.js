// 本機使用 127.0.0.1:5001，部署後使用 Zeabur。載入前可用 API_BASE_URL 或 DCCS_SUBMIT_URL 覆寫。

const PROD_API_BASE_URL = 'https://attention-lesson-plan-data.zeabur.app/api';

export function resolveApiBase() {
  const override =
    typeof window !== 'undefined' ? window.API_BASE_URL : null;
  if (override) return String(override).replace(/\/+$/, '');

  if (window.WebGameApi && window.WebGameApi.resolveApiBase) {
    return window.WebGameApi.resolveApiBase();
  }

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.protocol}//${host}:5001/api`;
  }
  return PROD_API_BASE_URL;
}

/**
 * 成績 POST 位址的優先順序：
 * window.DCCS_SUBMIT_URL > window.API_BASE_URL + '/sessions' > 同源 /api/sessions。
 * @returns {string}
 */
export function resolveSubmitUrl() {
  const override =
    typeof window !== 'undefined' ? window.DCCS_SUBMIT_URL : null;
  if (override) return String(override);

  return `${resolveApiBase()}/sessions`;
}
