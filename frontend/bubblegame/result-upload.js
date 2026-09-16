import { API } from '../js/api.js';
import { buildSessionPayload, studentFromStorage } from './session-payload.mjs';

// The built game emits this event once when its result overlay opens.

const dayInput = document.getElementById('current-day-input');
const loginStatus = document.getElementById('login-status');
const status = document.getElementById('save-status');
const retryButton = document.getElementById('retry-save-button');
const restartButton = document.getElementById('restart-button');
const backLink = document.querySelector('.result-panel .back-to-lobby');

let currentRun = null;
let pending = [];
let saving = false;

function showLoginStatus(mode) {
  const missingLogin = !studentFromStorage(sessionStorage, 1)
    || (mode === 'double' && !studentFromStorage(sessionStorage, 2));
  loginStatus.textContent = missingLogin
    ? '未登入所需的學生帳號；可以試玩，但結束後無法儲存成績。'
    : '遊戲結束後會自動儲存成績。';
  loginStatus.dataset.state = missingLogin ? 'error' : 'ready';
}

function createPairId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

showLoginStatus(new URLSearchParams(window.location.search).get('mode'));

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function setSaving(value) {
  saving = value;
  restartButton.disabled = value;
  retryButton.disabled = value;
  backLink.setAttribute('aria-disabled', String(value));
  backLink.tabIndex = value ? -1 : 0;
}

backLink.addEventListener('click', (event) => {
  if (saving) event.preventDefault();
});

window.addEventListener('beforeunload', (event) => {
  if (!saving) return;
  event.preventDefault();
  event.returnValue = '';
});

for (const id of ['start-single-button', 'start-multi-button']) {
  document.getElementById(id).addEventListener('click', (event) => {
    showLoginStatus(id === 'start-multi-button' ? 'double' : 'single');
    if (!dayInput.checkValidity()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dayInput.reportValidity();
      return;
    }
    currentRun = {
      startTime: Date.now(),
      currentDay: Number(dayInput.value),
      pairId: createPairId(),
    };
    pending = [];
    retryButton.classList.add('is-hidden');
    setStatus('');
  }, { capture: true });
}

async function savePending() {
  if (saving || pending.length === 0) return;
  setSaving(true);
  retryButton.classList.add('is-hidden');
  setStatus(`正在儲存 ${pending.length} 筆成績…`);

  const attempts = pending;
  const outcomes = await Promise.allSettled(attempts.map((entry) => API.submitGameSession(entry.payload)));
  const failed = [];
  const saved = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') saved.push(attempts[index].label);
    else failed.push({ ...attempts[index], error: outcome.reason });
  });
  pending = failed;
  setSaving(false);

  if (failed.length === 0) {
    setStatus(`${saved.join('、')}的成績已儲存。`, 'success');
  } else {
    const reason = failed[0].error instanceof Error ? failed[0].error.message : '網路或伺服器錯誤';
    setStatus(`${saved.length ? `${saved.join('、')}已儲存；` : ''}${failed.map((entry) => entry.label).join('、')}儲存失敗：${reason}`, 'error');
    retryButton.classList.remove('is-hidden');
  }
}

window.addEventListener('bubblegame:finished', (event) => {
  try {
    const { mode, players } = event.detail;
    const student1 = studentFromStorage(sessionStorage, 1);
    const student2 = mode === 'double' ? studentFromStorage(sessionStorage, 2) : null;
    if (!student1 || (mode === 'double' && !student2)) {
      setStatus('缺少學生登入資料，成績未儲存。請從登入頁重新進入遊戲。', 'error');
      return;
    }
    if (!currentRun) throw new Error('找不到本局開始時間');
    const students = mode === 'double' ? [student1, student2] : [student1];
    const endTime = Math.max(Date.now(), currentRun.startTime);
    pending = students.map((student, index) => ({
      label: mode === 'double' ? `學生 ${index + 1}` : '本局',
      payload: buildSessionPayload({
        student,
        stats: players[index],
        mode,
        pairId: currentRun.pairId,
        currentDay: currentRun.currentDay,
        startTime: currentRun.startTime,
        endTime,
      }),
    }));
    void savePending();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '成績資料無法送出', 'error');
  }
});

retryButton.addEventListener('click', () => { void savePending(); });
