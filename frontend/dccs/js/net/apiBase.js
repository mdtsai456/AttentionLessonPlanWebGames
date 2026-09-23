// 預設使用同源 API；可在載入前以 API_BASE_URL 或 DCCS_SUBMIT_URL 覆寫。

const API_PATH_PREFIX = '/api';

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
