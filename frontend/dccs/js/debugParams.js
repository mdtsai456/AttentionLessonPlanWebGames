// sessionSeconds 只供開發驗收；縮短場次仍會送出成績，啟用時必須顯示警告。

const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;

/**
 * 讀取 ?sessionSeconds=；未提供或不合法時回傳 null。
 * @param {string} [search] 預設取目前網址的 query string
 * @returns {number | null}
 */
export function readSessionSecondsOverride(search) {
  const raw =
    new URLSearchParams(
      search === undefined ? window.location.search : search
    ).get('sessionSeconds');

  if (raw === null || raw.trim() === '') return null;

  const seconds = Number(raw);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.warn(`sessionSeconds 不是正數，已忽略：${raw}`);
    return null;
  }

  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
    console.warn(
      `sessionSeconds 必須介於 ${MIN_SECONDS}–${MAX_SECONDS} 秒，已忽略：${raw}`
    );
    return null;
  }

  return seconds;
}

/**
 * 顯示非標準場次長度警告；重複呼叫不會新增標記。
 * @param {number} seconds
 */
export function markDebugSession(seconds) {
  const EXISTING_ID = 'dccs-debug-badge';
  if (document.getElementById(EXISTING_ID)) return;

  console.warn(
    `[除錯] 本場長度已改為 ${seconds} 秒（正常為 600 秒）。成績仍會照常送出，` +
      '請勿用於正式施測。'
  );

  const badge = document.createElement('div');
  badge.id = EXISTING_ID;
  badge.textContent = `除錯模式：本場 ${seconds} 秒，請勿用於正式施測`;
  badge.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 2147483647',
    'padding: 6px 12px',
    'background: #b3261e',
    'color: #fff',
    'font: 700 14px/1.4 -apple-system, "Noto Sans TC", sans-serif',
    'letter-spacing: 0.04em',
    'text-align: center',
    'pointer-events: none',
  ].join(';');

  document.body.appendChild(badge);
}
