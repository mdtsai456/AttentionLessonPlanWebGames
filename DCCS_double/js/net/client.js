// 成績 payload 與送出（SPEC 4.13）。回傳物件就是平台實際收到的內容。

import { resolveSubmitUrl } from './apiBase.js';

const STATS_PREFIX = 'DCCS_';
const SUBMIT_TIMEOUT_MS = 15_000;

// 送出失敗的 payload 暫存於 localStorage。使用固定的 key 前綴，供下次開始時重送。
const PENDING_PREFIX = 'dccs_pending_';

// 將伺服器永久拒絕的 payload 移至此 key 前綴。不再重送，並保留資料。
// 例如，school 未登記於平台名錄時，伺服器回傳 400。重試無法解決此錯誤，
// 若保留在待送佇列，會阻止後續有效成績送出。
const REJECTED_PREFIX = 'dccs_rejected_';

// 這些 4xx 錯誤可重試。其餘 4xx 錯誤視為永久拒絕。
const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

function isPermanentRejection(status) {
  if (typeof status !== 'number') return false;
  if (status < 400 || status >= 500) return false;
  return !RETRYABLE_CLIENT_STATUSES.has(status);
}

function requiredInteger(value, name) {
  const normalized =
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ms')
      ? Number(value.ms)
      : Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error(`buildPayload: ${name} must be a safe integer`);
  }
  return normalized;
}

/**
 * @param {{lessonId: string, student: object, summary: object}} args
 * @returns {object}
 */
export function buildPayload({ lessonId, student, summary }) {
  const { grade, caseId, school, currentDay, startTime, endTime } = student || {};
  const normalizedCurrentDay = requiredInteger(currentDay, 'currentDay');
  const normalizedStartTime = requiredInteger(startTime, 'startTime');
  const normalizedEndTime = requiredInteger(endTime, 'endTime');

  const stats = [
    { apiname: `${STATS_PREFIX}correct`, value: summary.correct_count },
    { apiname: `${STATS_PREFIX}wrong`, value: summary.wrong_count },
    { apiname: `${STATS_PREFIX}accuracy`, value: summary.accuracy },
    { apiname: `${STATS_PREFIX}duration`, value: summary.duration },
    { apiname: `${STATS_PREFIX}stage`, value: summary.stage },
    { apiname: `${STATS_PREFIX}frameCorrectCount`, value: summary.frameCorrectCount },
    { apiname: `${STATS_PREFIX}frameWrongCount`, value: summary.frameWrongCount },
    { apiname: `${STATS_PREFIX}categoryCorrectCount`, value: summary.categoryCorrectCount },
    { apiname: `${STATS_PREFIX}categoryWrongCount`, value: summary.categoryWrongCount },
    { apiname: `${STATS_PREFIX}modelCorrectCount`, value: summary.modelCorrectCount },
    { apiname: `${STATS_PREFIX}modelWrongCount`, value: summary.modelWrongCount },
    { apiname: `${STATS_PREFIX}levelsPlayed`, value: summary.levelsPlayed },
  ];

  const played = Array.isArray(summary.levelAccuracy) ? summary.levelAccuracy : [];
  const stageCount = Number(summary.stage);
  const kept = Number.isFinite(stageCount) && stageCount > 0
    ? played.slice(0, stageCount)
    : played;
  if (kept.length) {
    stats.push({
      apiname: `${STATS_PREFIX}levelAccuracy`,
      value: kept.map((value) => Number(value.toFixed(4))).join(','),
    });
  }
  if (Number.isFinite(summary.avgReactionMs)) {
    stats.push({ apiname: `${STATS_PREFIX}avgReactionMs`, value: summary.avgReactionMs });
  }
  if (Number.isFinite(summary.questionCount)) {
    stats.push({ apiname: `${STATS_PREFIX}questionCount`, value: summary.questionCount });
  }

  return {
    lessonId,
    data: {
      grade,
      caseId,
      school,
      currentDay: normalizedCurrentDay,
      startTime: normalizedStartTime,
      endTime: normalizedEndTime,
      mode: 'single',
      stats,
    },
  };
}

/**
 * 只執行 POST，不暫存資料。失敗時拋出錯誤，由呼叫端處理。
 * @param {object} payload
 * @param {string} url
 * @returns {Promise<string>} 伺服器回應的原始內容
 */
async function postPayload(payload, url, player) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  try {
    const res = window.WebGameApi?.submitSession
      ? await window.WebGameApi.submitSession(payload, { url, player, signal: controller.signal })
      : await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

    const text = await res.text();

    if (!res.ok) {
      const error = new Error(
        `server responded ${res.status}${text ? `: ${text}` : ''}`
      );
      // 讓呼叫端區分暫時送出失敗與永久拒絕。
      error.status = res.status;
      throw error;
    }

    return text;
  } finally {
    // 逾時範圍包含回應本文的讀取，避免收到 headers 後持續等待。
    clearTimeout(timeout);
  }
}

/**
 * POST 至指定端點；失敗時將 payload 暫存於 localStorage，等下次開場重送。
 * @param {object} payload
 * @param {{url?: string}} [opts]
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function submitResult(payload, { url = resolveSubmitUrl(), player } = {}) {
  try {
    const detail = await postPayload(payload, url, player);
    return { ok: true, detail };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    try {
      // 雙人模式可能在同一毫秒送出兩筆資料。加入亂數，避免 key 重複。
      const key = `${PENDING_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (_storageErr) {
      // localStorage 不可用時仍回傳原始送出錯誤。
    }
    return { ok: false, detail: message };
  }
}

/**
 * 列出目前暫存中、尚未送出的成績。
 * @returns {Array<{key: string, payload: object}>} 依 key 排序（即產生順序）
 */
export function listPendingResults() {
  return collectByPrefix(PENDING_PREFIX);
}

/**
 * 列出 localStorage 中指定前綴的 payload，依 key 排序，即產生順序。
 * @param {string} prefix
 * @returns {Array<{key: string, payload: object}>}
 */
function collectByPrefix(prefix) {
  const found = [];
  let storage;
  try {
    storage = window.localStorage;
    if (!storage) return found;
  } catch (_err) {
    // 隱私模式等情況下，讀取 localStorage 可能拋出錯誤。
    return found;
  }

  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  keys.sort();

  for (const key of keys) {
    let payload;
    try {
      payload = JSON.parse(storage.getItem(key));
    } catch (_err) {
      // 刪除已損壞的資料，避免持續累積。
      try {
        storage.removeItem(key);
      } catch (_removeErr) {
        /* 忽略刪除失敗。 */
      }
      continue;
    }
    if (payload && typeof payload === 'object') found.push({ key, payload });
  }

  return found;
}

/**
 * 重送所有暫存成績。成功後刪除資料，失敗時保留原資料供下次重送。
 *
 * 不呼叫 submitResult()，因為該函式在失敗時會新增暫存資料。
 * 重送失敗若再新增資料，會使暫存持續增加。
 *
 * @param {{url?: string}} [opts]
 * @returns {Promise<{attempted: number, sent: number, failed: number,
 *                    rejected: number}>}
 */
async function flushPending({ url = resolveSubmitUrl() } = {}) {
  const pending = listPendingResults();
  let attempted = 0;
  let sent = 0;
  let failed = 0;

  let rejected = 0;

  for (const { key, payload } of pending) {
    if (window.WebGameApi?.sessionPlayer && window.WebGameApi.sessionPlayer(payload) < 0) continue;
    attempted += 1;
    try {
      await postPayload(payload, url);
      try {
        window.localStorage.removeItem(key);
      } catch (_removeErr) {
        // 送出成功但刪除失敗時，下次會重送。後端以唯一鍵防止重複寫入。
      }
      sent += 1;
    } catch (err) {
      if (isPermanentRejection(err && err.status)) {
        // 移至 rejected 區，停止重送，並保留資料供人工處理。
        // 若未移出此資料，會阻止後續有效成績送出。
        console.error(
          '成績被伺服器拒絕，已移出待送佇列（需要人工處理）：',
          err.message,
          payload
        );

        try {
          window.localStorage.setItem(
            key.replace(PENDING_PREFIX, REJECTED_PREFIX),
            JSON.stringify(payload)
          );
          window.localStorage.removeItem(key);
        } catch (_moveErr) {
          // 移動失敗時，保留原資料。
        }

        rejected += 1;
        continue;
      }

      // 暫時失敗時，例如斷線或 5xx，保留原資料，並停止本次後續重試。
      failed += 1;
      break;
    }
  }

  return { attempted, sent, failed, rejected };
}

/**
 * 列出伺服器永久拒絕且已移出待送佇列的成績，供人工處理。
 * @returns {Array<{key: string, payload: object}>}
 */
export function listRejectedResults() {
  return collectByPrefix(REJECTED_PREFIX);
}

// 雙人模式同時掛載兩個遊戲實例時，共用一次重送，避免重複寫入。
let flushing = null;
export function flushPendingResults(opts) {
  if (!flushing) flushing = flushPending(opts).finally(() => { flushing = null; });
  return flushing;
}
