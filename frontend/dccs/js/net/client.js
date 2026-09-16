// 成績 payload 與送出（SPEC 4.13）。回傳物件就是平台實際收到的內容。

import { resolveSubmitUrl } from './apiBase.js';

const STATS_PREFIX = 'DCCS_';

// 送出失敗的 payload 暫存在 localStorage，key 前綴固定，供下次開場時重送。
const PENDING_PREFIX = 'dccs_pending_';

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
 * 單純 POST，不做任何暫存。失敗一律 throw，由呼叫端決定怎麼處理。
 * @param {object} payload
 * @param {string} url
 * @returns {Promise<string>} 伺服器回應的原始內容
 */
async function postPayload(payload, url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    throw new Error(`server responded ${res.status}${text ? `: ${text}` : ''}`);
  }

  return text;
}

/**
 * POST 至指定端點；失敗時將 payload 暫存於 localStorage，等下次開場重送。
 * @param {object} payload
 * @param {{url?: string}} [opts]
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function submitResult(payload, { url = resolveSubmitUrl() } = {}) {
  try {
    const detail = await postPayload(payload, url);
    return { ok: true, detail };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    try {
      // 同一毫秒內送出兩筆（雙人模式）會撞 key，補一段亂數區隔。
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
  const found = [];
  let storage;
  try {
    storage = window.localStorage;
    if (!storage) return found;
  } catch (_err) {
    // 隱私模式等情況下讀 localStorage 會 throw。
    return found;
  }

  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(PENDING_PREFIX)) keys.push(key);
  }
  keys.sort();

  for (const key of keys) {
    let payload;
    try {
      payload = JSON.parse(storage.getItem(key));
    } catch (_err) {
      // 內容已經壞掉，留著也沒用，直接清掉免得無限累積。
      try {
        storage.removeItem(key);
      } catch (_removeErr) {
        /* 清不掉就算了 */
      }
      continue;
    }
    if (payload && typeof payload === 'object') found.push({ key, payload });
  }

  return found;
}

/**
 * 重送所有暫存的成績。成功的才刪掉，失敗的原封不動留到下次。
 *
 * 刻意不走 submitResult()——那支失敗時會再寫一筆新的暫存，重送一旦失敗就會
 * 讓暫存無限增生。
 *
 * @param {{url?: string}} [opts]
 * @returns {Promise<{attempted: number, sent: number, failed: number}>}
 */
export async function flushPendingResults({ url = resolveSubmitUrl() } = {}) {
  const pending = listPendingResults();
  let sent = 0;
  let failed = 0;

  for (const { key, payload } of pending) {
    try {
      await postPayload(payload, url);
      try {
        window.localStorage.removeItem(key);
      } catch (_removeErr) {
        // 送出去了但刪不掉——下次會重送一次，由後端的唯一鍵擋掉重複。
      }
      sent += 1;
    } catch (_err) {
      // 多半是伺服器仍未就緒；剩下的這次不用再試了。
      failed += 1;
      break;
    }
  }

  return { attempted: pending.length, sent, failed };
}
