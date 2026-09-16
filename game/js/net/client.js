// 成績 payload 與送出（SPEC 4.13）。回傳物件就是平台實際收到的內容。

const STATS_PREFIX = 'DCCS_';

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
 * POST 至指定端點；失敗時將 payload 暫存於 localStorage。
 * @param {object} payload
 * @param {{url?: string}} [opts]
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function submitResult(payload, { url = '/api/results' } = {}) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => '');

    if (!res.ok) {
      throw new Error(`server responded ${res.status}${text ? `: ${text}` : ''}`);
    }

    return { ok: true, detail: text };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    try {
      const key = `dccs_pending_${Date.now()}`;
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (_storageErr) {
      // localStorage 不可用時仍回傳原始送出錯誤。
    }
    return { ok: false, detail: message };
  }
}
