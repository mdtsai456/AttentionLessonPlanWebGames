// 後端位址由 shared/api-base.js 決定。載入前可用 DCCS_SUBMIT_URL 覆寫成績送出位址。

/**
 * 成績 POST 位址的優先順序：
 * window.DCCS_SUBMIT_URL > window.resolveApiBase() + '/sessions'。
 * @returns {string}
 */
export function resolveSubmitUrl() {
  const override =
    typeof window !== 'undefined' ? window.DCCS_SUBMIT_URL : null;
  if (override) return String(override);

  return `${window.resolveApiBase()}/sessions`;
}
