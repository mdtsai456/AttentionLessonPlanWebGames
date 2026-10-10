// 大廳資料來自同源的 sessionStorage。currentDay 暫由歷史場次推導，
// 後續應由後端統一提供，避免各遊戲計算結果不同（見 docs/dccs-lobby-handoff.md）。

import { resolveApiBase } from './net/apiBase.js';

const KEY_MODE = 'game_mode';

function readKey(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (_err) {
    // 隱私模式下，讀取 sessionStorage 可能拋出錯誤。此時視為沒有大廳資訊。
    return null;
  }
}

export function readStoredCurrentDay() {
  const raw = readKey("current_day");
  const day = Number(raw);
  return Number.isFinite(day) && day >= 1 ? day : null;
}

/**
 * 後端 auth.py 產生的 studentKey 格式為 G1_S03，即 grade_caseId。
 * caseId 可包含底線，因此只使用第一個底線分隔。
 * @param {string | null} studentKey
 * @returns {{grade: string, caseId: string} | null}
 */
function splitStudentKey(studentKey) {
  if (!studentKey) return null;
  const idx = studentKey.indexOf('_');
  if (idx <= 0 || idx === studentKey.length - 1) return null;
  return {
    grade: studentKey.slice(0, idx),
    caseId: studentKey.slice(idx + 1),
  };
}

/**
 * 讀出大廳登入的第 slot 位玩家（1 或 2）。
 * @param {1 | 2} slot
 * @returns {{grade: string, caseId: string, school: string, studentKey: string,
 *            token: string | null} | null}
 */
export function readLobbyPlayer(slot) {
  const studentKey = readKey(`student${slot}_key`);
  const school = readKey(`student${slot}_school`) || (slot === 1 ? readKey("school") : null);
  const grade = readKey(`student${slot}_grade`);
  const caseId = readKey(`student${slot}_case`);
  const parts = splitStudentKey(studentKey);
  const resolvedGrade = grade || (parts && parts.grade);
  const resolvedCase = caseId || (parts && parts.caseId);
  if (!resolvedGrade || !resolvedCase || !school) return null;

  return {
    grade: resolvedGrade,
    caseId: resolvedCase,
    school,
    studentKey: studentKey || `${resolvedGrade}_${resolvedCase}`,
    currentDay: Number(readKey(`student${slot}_day`)) || readStoredCurrentDay(),
    // 單人模式另有共用的 token。雙人模式的第二位玩家僅使用 student2_token。
    token: readKey(`student${slot}_token`) || (slot === 1 ? readKey("token") : null),
  };
}

/**
 * 判斷頁面是否由大廳進入，並回傳該場玩家資料。
 * @returns {{mode: 'single' | 'double',
 *            players: Array<object>} | null} 未由大廳進入時，回傳 null。
 */
export function readLobbySession() {
  const player1 = readLobbyPlayer(1);
  if (!player1) return null;

  const player2 = readLobbyPlayer(2);
  const wantsDouble = readKey(KEY_MODE) === 'double';

  if (wantsDouble && player2) {
    return { mode: 'double', players: [player1, player2] };
  }
  return { mode: 'single', players: [player1] };
}

/** 將後端的 "YYYY-MM-DD HH:MM:SS" 格式 UTC naive 時間轉為本地時區的 Date。 */
function parseUtcTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 推導學生今日的 currentDay。
 *
 * 施測日使用本地日曆日期。後端儲存 UTC 時間，比較前須轉為本地時區。
 * 今日已玩過其他遊戲時，沿用當日值。否則使用歷史最大值加 1。沒有記錄時，使用 1。
 *
 * 失敗時拋出錯誤，不使用推測值，避免錯誤的 currentDay 影響研究資料。
 * 由現場人員手動填入數值。
 *
 * @param {{grade: string, caseId: string, school: string, token: string|null}} player
 * @returns {Promise<number>}
 */
export async function resolveCurrentDay(player) {
  if (!player || !player.token) {
    throw new Error('resolveCurrentDay: 缺少登入 token，無法查詢既有場次');
  }

  const url =
    `${resolveApiBase()}/students/` +
    `${encodeURIComponent(`${player.grade}_${player.caseId}`)}/sessions` +
    `?school=${encodeURIComponent(player.school)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${player.token}` },
  });

  if (!res.ok) {
    throw new Error(`resolveCurrentDay: 查詢場次失敗（HTTP ${res.status}）`);
  }

  const body = await res.json();
  const sessions = Array.isArray(body && body.sessions) ? body.sessions : [];
  if (sessions.length === 0) return 1;

  const todayKey = new Date().toDateString();
  let maxSeen = 0;
  let todaysDay = null;

  for (const session of sessions) {
    const day = Number(session.currentDay);
    if (!Number.isFinite(day)) continue;
    if (day > maxSeen) maxSeen = day;

    const startedAt = parseUtcTimestamp(session.startTime);
    if (startedAt && startedAt.toDateString() === todayKey) {
      // 同一施測日的五款遊戲共用 currentDay。取當日的最大值，
      // 避免先前場次的較低錯誤值影響當日結果。
      todaysDay = todaysDay === null ? day : Math.max(todaysDay, day);
    }
  }

  if (todaysDay !== null) return todaysDay;
  return maxSeen + 1;
}

export function returnToLobby() {
  window.location.href = '../Select/index.html';
}
