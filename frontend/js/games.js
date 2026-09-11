import { API } from './api.js';

// 遊戲大廳（圖5）：登入後的學生落地頁。這次先做靜態佔位——列出遊戲卡片，
// 點擊顯示「即將推出」，不接真的 Unity 遊戲（這個 repo 沒有實際遊戲，見
// docs/adr/0004-teacher-student-password-login.md 的「不在這次範圍內」）。

const GAME_ICONS = {
  DAT: '🎯',
  DCCS: '🃏',
  EFT: '🔍',
  IM: '⏱️',
  TGame: '🏃',
};

const role = sessionStorage.getItem('user_role');
const mode = sessionStorage.getItem('game_mode') || 'single';
const student1Key = sessionStorage.getItem('student1_key');
const student2Key = sessionStorage.getItem('student2_key');
const student1Token = sessionStorage.getItem('student1_token');
const student2Token = sessionStorage.getItem('student2_token');

if (role !== 'student' || !student1Key || (mode === 'double' && !student2Key)) {
  window.location.href = 'index.html';
}

const modeBadge = document.getElementById('mode-badge');
const playersEl = document.getElementById('players');
const gamesGrid = document.getElementById('games-grid');
const loadingHint = document.getElementById('loading-hint');
const toast = document.getElementById('toast');
const btnLogout = document.getElementById('btn-logout');

modeBadge.textContent = mode === 'double' ? '雙人模式' : '單人模式';
playersEl.innerHTML = `<span class="player-chip">${student1Key}</span>`;
if (mode === 'double') {
  playersEl.innerHTML += `<span class="player-chip">${student2Key}</span>`;
}

btnLogout.addEventListener('click', async () => {
  await Promise.all([
    student1Token ? API.logout(student1Token) : Promise.resolve(),
    student2Token ? API.logout(student2Token) : Promise.resolve(),
  ]);
  sessionStorage.clear();
  window.location.href = 'index.html';
});

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2000);
}

function renderGames(games) {
  loadingHint.hidden = true;
  const visible = mode === 'double' ? games.filter((g) => g.doubleCapable) : games;

  if (visible.length === 0) {
    gamesGrid.innerHTML = '<p class="hint">目前沒有可玩的遊戲。</p>';
    return;
  }

  gamesGrid.innerHTML = '';
  visible.forEach((game) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'game-card';
    card.innerHTML = `
      <span class="icon">${GAME_ICONS[game.gameType] || '🎮'}</span>
      <span class="name">${game.gameType}</span>
      ${game.doubleCapable ? '<span class="double-tag">支援雙人</span>' : ''}
    `;
    card.addEventListener('click', () => showToast(`${game.gameType} 即將推出，敬請期待！`));
    gamesGrid.appendChild(card);
  });
}

async function init() {
  try {
    const games = await API.getGames();
    renderGames(games);
  } catch (e) {
    loadingHint.textContent = '無法連線至後端，請確認伺服器是否已啟動。';
  }
}

init();
