// 本機打 127.0.0.1:5001；上線打 Zeabur。可在載入前以 API_BASE_URL 或 DCCS_SUBMIT_URL 覆寫。

const PROD_API_BASE_URL = 'https://attention-lesson-plan-data.zeabur.app/api';

export function resolveApiBase() {
  const override =
    typeof window !== 'undefined' ? window.API_BASE_URL : null;
  if (override) return String(override).replace(/\/+$/, '');

  if (window.WedGameApi && window.WedGameApi.resolveApiBase) {
    return window.WedGameApi.resolveApiBase();
  }

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.protocol}//${host}:5001/api`;
  }
  return PROD_API_BASE_URL;
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
