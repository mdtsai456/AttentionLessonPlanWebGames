// shared/login-share.js：同一個瀏覽器的分頁共用一組登入。
// 用 vm 模擬多個分頁：共用同一份 localStorage，各自有 sessionStorage；
// 跟瀏覽器一樣，localStorage 改變時只通知「其他」分頁（storage 事件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const SOURCE = fs.readFileSync(`${SITE_ROOT}/shared/login-share.js`, 'utf8');
const SHARED_KEY = 'webgame_login';
const ALIVE_KEY = 'webgame_login_alive';

const STUDENT = {
  user_role: 'student', login_role: 'student', game_mode: 'single', token: 's-token',
  student1_token: 's-token', student1_key: 'G1_S01', student1_case: 'S01',
  student1_grade: 'G1', student1_school: 'A', student1_day: '3',
  grade: 'G1', caseId: 'S01', school: 'A', current_day: '3', currentDay: '3',
};

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
  };
}

/** 一個瀏覽器：分頁共用 localStorage。 */
function browser({ localThrows = false } = {}) {
  const tabs = [];
  const shared = memoryStorage();
  function localFor(tab) {
    const notify = (key) => tabs
      .filter((other) => other !== tab && !other.closed)
      .forEach((other) => other.fire('storage', { key }));
    return {
      getItem: (key) => { if (localThrows) throw new Error('blocked'); return shared.getItem(key); },
      setItem: (key, value) => { if (localThrows) throw new Error('blocked'); shared.setItem(key, value); notify(key); },
      removeItem: (key) => { if (localThrows) throw new Error('blocked'); shared.removeItem(key); notify(key); },
    };
  }

  /** 開一個分頁並載入 login-share.js。session 是這個分頁原本的 sessionStorage 內容。 */
  function open({ page = 'Select', session = {}, manual = page === 'Home' } = {}) {
    const listeners = {};
    const tab = {
      replaced: [],
      closed: false,
      session: memoryStorage(session),
      fire(name, event) { (listeners[name] || []).forEach((fn) => fn(event)); },
    };
    const window = {
      location: { replace: (url) => tab.replaced.push(url) },
      addEventListener: (name, fn) => (listeners[name] ||= []).push(fn),
      localStorage: localFor(tab),
      crypto: globalThis.crypto,
    };
    const document = {
      currentScript: {
        src: `https://example.test/shared/login-share.js`,
        dataset: manual ? { restore: 'manual' } : {},
      },
    };
    tabs.push(tab);
    vm.runInNewContext(SOURCE, { window, document, sessionStorage: tab.session, URL, JSON });
    tab.login = window.WebGameLogin;
    return tab;
  }

  return { open, shared };
}

/** 模擬 Home 登入成功：寫好 sessionStorage 後呼叫 save()。 */
function loginIn(tab, values = STUDENT) {
  tab.session.clear();
  Object.entries(values).forEach(([key, value]) => tab.session.setItem(key, value));
  tab.login.save();
}

// 存副本與新分頁

test('登入後存成副本：只存登入欄位，不存各分頁自己的狀態', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home, { ...STUDENT, login_expires_at: '123', attention_fireworks_shown: '1' });

  const saved = JSON.parse(b.shared.getItem(SHARED_KEY));
  assert.deepEqual(saved.data, STUDENT);
  assert.equal(typeof saved.id, 'string');
  assert.equal(home.session.getItem('login_share_id'), saved.id);
});

test('新分頁直接帶入登入，不用重新登入', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }));

  const tab = b.open({ page: 'Select' });

  for (const [key, value] of Object.entries(STUDENT)) assert.equal(tab.session.getItem(key), value);
  assert.deepEqual(tab.replaced, []);
});

test('雙人登入兩位學生的欄位都會帶入', () => {
  const b = browser();
  const duo = {
    ...STUDENT, game_mode: 'double',
    student2_token: 's2-token', student2_key: 'G2_S02', student2_case: 'S02',
    student2_grade: 'G2', student2_school: 'B', student2_day: '1', student2_account: 'S002',
  };
  loginIn(b.open({ page: 'Home' }), duo);

  const tab = b.open({ page: 'DCCS_double' });

  assert.equal(tab.session.getItem('student2_token'), 's2-token');
  assert.equal(tab.session.getItem('student2_school'), 'B');
  assert.equal(tab.session.getItem('game_mode'), 'double');
});

test('老師登入也會帶入', () => {
  const b = browser();
  const teacher = { user_role: 'teacher', login_role: 'teacher', token: 't-token', teacher_id: '7', teacher_name: '吳老師', teacher_school: 'A' };
  loginIn(b.open({ page: 'Home' }), teacher);

  const tab = b.open({ page: 'Teacher_platform' });

  assert.equal(tab.session.getItem('teacher_name'), '吳老師');
  assert.equal(tab.session.getItem('token'), 't-token');
});

test('沒有副本時新分頁維持未登入（交給 require-student 導回登入頁）', () => {
  const b = browser();
  const tab = b.open({ page: 'Select' });

  assert.equal(tab.session.getItem('user_role'), null);
  assert.deepEqual(tab.replaced, []);
});

test('已登入的分頁重新整理時不會被副本覆蓋', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  // 分頁自己的狀態（例如煙火已顯示）重新整理後要保留。
  const tab = b.open({ page: 'Select', session: { ...home.session.data, attention_fireworks_shown: '1' } });

  assert.equal(tab.session.getItem('attention_fireworks_shown'), '1');
});

test('副本內容損毀時視為沒有登入', () => {
  const b = browser();
  b.shared.setItem(SHARED_KEY, '{not json');
  const tab = b.open({ page: 'Select' });

  assert.equal(tab.session.getItem('user_role'), null);
});

test('副本不會寫入登入欄位以外的 key', () => {
  const b = browser();
  b.shared.setItem(SHARED_KEY, JSON.stringify({ id: 'x', data: { ...STUDENT, evil: '1' } }));
  b.shared.setItem(ALIVE_KEY, JSON.stringify({ id: 'x', tabs: { other: Date.now() } }));
  const tab = b.open({ page: 'Select' });

  assert.equal(tab.session.getItem('evil'), null);
  assert.equal(tab.session.getItem('user_role'), 'student');
});

// 登出、失效、換帳號

test('一個分頁登出，其他分頁回登入頁並清掉登入', () => {
  const b = browser();
  const a = b.open({ page: 'Home' });
  loginIn(a);
  const other = b.open({ page: 'TGame_single' });

  a.login.forget();
  a.session.clear();

  assert.equal(b.shared.getItem(SHARED_KEY), null);
  assert.deepEqual(other.replaced, ['https://example.test/Home/index.html']);
  assert.equal(other.session.getItem('user_role'), null);
});

test('別的分頁換了帳號，舊分頁回登入頁', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  const game = b.open({ page: 'EFT_single' });

  loginIn(b.open({ page: 'Home' }), { ...STUDENT, caseId: 'S02', student1_case: 'S02' });

  assert.equal(game.replaced.length, 1);
  assert.equal(game.session.getItem('caseId'), null);
});

test('副本已被別的分頁換掉時，舊分頁的 forget 不能刪掉新登入', () => {
  const b = browser();
  const old = b.open({ page: 'Home' });
  loginIn(old);
  const oldSession = { ...old.session.data };
  const fresh = b.open({ page: 'Home' });
  loginIn(fresh, { ...STUDENT, caseId: 'S02' });
  // 舊分頁在背景沒收到事件（例如被凍結），之後才發現登入失效。
  const stale = b.open({ page: 'Select', session: oldSession, manual: true });

  stale.login.forget();

  assert.equal(JSON.parse(b.shared.getItem(SHARED_KEY)).data.caseId, 'S02');
});

test('forget({ force: true }) 一律刪除副本', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }));
  const other = b.open({ page: 'Home' });

  other.login.forget({ force: true });

  assert.equal(b.shared.getItem(SHARED_KEY), null);
});

test('沒登入的分頁收到登出事件時不導頁', () => {
  const b = browser();
  const a = b.open({ page: 'Home' });
  loginIn(a);
  const idle = b.open({ page: 'Home' });

  a.login.forget();

  assert.deepEqual(idle.replaced, []);
});

test('本功能上線前就登入的分頁（沒有登入 id）維持原本行為', () => {
  const b = browser();
  const legacy = b.open({ page: 'Select', session: { ...STUDENT } });
  loginIn(b.open({ page: 'Home' }), { ...STUDENT, caseId: 'S02' });

  assert.deepEqual(legacy.replaced, []);
  assert.equal(legacy.session.getItem('caseId'), 'S01');
});

test('整個 localStorage 被清空（key 為 null）也視為登出', () => {
  const b = browser();
  const a = b.open({ page: 'Home' });
  loginIn(a);
  const other = b.open({ page: 'Select' });

  b.shared.removeItem(SHARED_KEY);
  other.fire('storage', { key: null });

  assert.equal(other.replaced.length, 1);
});

test('無關的 localStorage key 改變不影響登入', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }));
  const other = b.open({ page: 'Select' });

  other.fire('storage', { key: 'dccs_outbox_1' });

  assert.deepEqual(other.replaced, []);
});

// 錯過事件：開啟時與從 bfcache 返回時檢查

test('分頁重新載入時發現登入已在別處登出，回登入頁', () => {
  const b = browser();
  const a = b.open({ page: 'Home' });
  loginIn(a);
  const saved = { ...a.session.data };
  a.login.forget();

  const reopened = b.open({ page: 'Select', session: saved });

  assert.equal(reopened.replaced.length, 1);
  assert.equal(reopened.session.getItem('user_role'), null);
});

test('從 bfcache 返回時發現帳號已換，回登入頁', () => {
  const b = browser();
  const a = b.open({ page: 'Home' });
  loginIn(a);
  const cached = b.open({ page: 'Select' });
  cached.closed = true; // 在 bfcache 裡收不到 storage 事件
  loginIn(b.open({ page: 'Home' }), { ...STUDENT, caseId: 'S02' });
  assert.deepEqual(cached.replaced, []);

  cached.closed = false;
  cached.fire('pageshow', { persisted: true });

  assert.equal(cached.replaced.length, 1);
});

test('一般 pageshow（非 bfcache）不重複檢查', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }));
  const tab = b.open({ page: 'Select' });

  tab.fire('pageshow', { persisted: false });

  assert.deepEqual(tab.replaced, []);
});

// 登入頁

test('登入頁不自動帶入，由 adopt() 決定', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }));

  const home = b.open({ page: 'Home' });
  assert.equal(home.session.getItem('user_role'), null);

  assert.equal(home.login.adopt(), 'student');
  assert.equal(home.session.getItem('token'), 's-token');
});

test('adopt() 沒有副本時回傳 null，不動 sessionStorage', () => {
  const b = browser();
  const home = b.open({ page: 'Home', session: { keep: '1' } });

  assert.equal(home.login.adopt(), null);
  assert.equal(home.session.getItem('keep'), '1');
});

test('登入頁停留時，別的分頁登入成功會通知', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  let notified = 0;
  home.login.onSharedLogin(() => { notified += 1; });

  loginIn(b.open({ page: 'Home' }));

  assert.equal(notified, 1);
});

test('sharedTokens() 回傳副本中的 token（去重）', () => {
  const b = browser();
  loginIn(b.open({ page: 'Home' }), { ...STUDENT, game_mode: 'double', student2_token: 's2-token' });
  const tab = b.open({ page: 'Home' });

  assert.deepEqual([...tab.login.sharedTokens()], ['s-token', 's2-token']);
});

test('sharedTokens() 沒有副本時回傳空陣列', () => {
  assert.deepEqual([...browser().open({ page: "Home" }).login.sharedTokens()], []);
});

// localStorage 無法使用

test('localStorage 無法使用時，登入仍可在原分頁使用', () => {
  const b = browser({ localThrows: true });
  const home = b.open({ page: 'Home' });

  assert.doesNotThrow(() => loginIn(home));
  assert.equal(home.session.getItem('user_role'), 'student');
  assert.deepEqual([...home.login.sharedTokens()], []);
  assert.doesNotThrow(() => home.login.forget());
});

test('localStorage 無法使用時，新分頁維持未登入且不報錯', () => {
  const b = browser({ localThrows: true });
  const tab = b.open({ page: 'Select' });

  assert.equal(tab.session.getItem('user_role'), null);
  assert.deepEqual(tab.replaced, []);
});

// 只在還有分頁開著時共用（瀏覽器全關後，下一位要重新登入）

test('登入的分頁都關閉（pagehide）後，新分頁不沿用登入', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  const select = b.open({ page: 'Select' }); // 新分頁：自動沿用登入，有自己的分頁 id
  assert.equal(select.session.getItem('user_role'), 'student');
  home.fire('pagehide', {});
  home.closed = true;
  select.fire('pagehide', {});
  select.closed = true;

  const next = b.open({ page: 'Select' });

  assert.equal(next.session.getItem('user_role'), null);
  assert.equal(next.replaced.length, 0);
});

test('還有一個分頁開著時，新分頁照常沿用', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  const select = b.open({ page: 'Select' }); // 新分頁：自動沿用登入，有自己的分頁 id
  assert.equal(select.session.getItem('user_role'), 'student');
  home.fire('pagehide', {});
  home.closed = true;

  const next = b.open({ page: 'Select' });

  assert.equal(next.session.getItem('user_role'), 'student');
  assert.equal(select.replaced.length, 0);
});

test('瀏覽器當掉（沒有 pagehide）時，超過 30 秒沒回報就不再沿用', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  const alive = JSON.parse(b.shared.getItem(ALIVE_KEY));
  Object.keys(alive.tabs).forEach((id) => { alive.tabs[id] = Date.now() - 31 * 1000; });
  b.shared.setItem(ALIVE_KEY, JSON.stringify(alive));
  home.closed = true;

  const next = b.open({ page: 'Select' });
  const login = b.open({ page: 'Home' });

  assert.equal(next.session.getItem('user_role'), null);
  assert.equal(login.login.adopt(), null);
});

test('沒人沿用的舊副本不會被刪掉：背景分頁只是暫時沒回報，不能因此被登出', () => {
  const b = browser();
  const home = b.open({ page: 'Home' });
  loginIn(home);
  const alive = JSON.parse(b.shared.getItem(ALIVE_KEY));
  Object.keys(alive.tabs).forEach((id) => { alive.tabs[id] = Date.now() - 60 * 1000; });
  b.shared.setItem(ALIVE_KEY, JSON.stringify(alive));

  b.open({ page: 'Select' });

  assert.ok(b.shared.getItem(SHARED_KEY));
  assert.equal(home.replaced.length, 0);
});

test('localStorage 寫不進去時，換到下一頁也不會被當成已在別處登出', () => {
  const b = browser({ localThrows: true });
  const home = b.open({ page: 'Home' });
  loginIn(home);

  const next = b.open({ page: 'Select', session: { ...home.session.data } });

  assert.equal(next.replaced.length, 0);
  assert.equal(next.session.getItem('user_role'), 'student');
});

test('載入時發現已被換帳號：只回登入頁，不把新帳號複製進這個分頁', () => {
  const b = browser();
  const first = b.open({ page: 'Home' });
  loginIn(first);
  const oldSession = { ...first.session.data };
  const other = b.open({ page: 'Home' });
  loginIn(other, { ...STUDENT, token: 'other', student1_token: 'other', student1_key: 'G1_S02' });

  const stale = b.open({ page: 'Select', session: oldSession });

  assert.equal(stale.replaced.length, 1);
  assert.equal(stale.session.getItem('user_role'), null);
});
