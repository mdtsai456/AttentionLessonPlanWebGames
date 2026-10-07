// 所有功能頁共用守門；在 head 同步執行，功能腳本驗證成功後才依序載入。
(function (global) {
  const entry = document.currentScript;
  const root = new URL('../', entry.src);
  const expectedRole = entry.dataset.role || 'student';
  const pageMode = entry.dataset.mode || 'select';
  const nativeTimeout = global.setTimeout.bind(global);
  const nativeClear = global.clearTimeout.bind(global);
  const realNow = Date.now.bind(Date);
  let authenticated = null;
  let bootPromise;
  let away = false;
  let checking = false;
  let generation = 0;
  let expiryTimer;

  function hide() {
    document.documentElement.style.visibility = 'hidden';
    document.documentElement.inert = true;
    if (global.WebGameRuntime) global.WebGameRuntime.pause();
  }

  function home(reason, clear) {
    hide();
    if (clear) sessionStorage.clear();
    const url = new URL('Home/index.html', root);
    if (reason) url.searchParams.set('auth', reason);
    global.location.replace(url.href);
  }

  function apiBase() {
    if (global.API_BASE_URL) return global.API_BASE_URL;
    if (global.location.pathname.startsWith('/app/')) return global.location.origin + '/api';
    const { hostname, protocol } = global.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:5001/api`;
    return 'https://attention-lesson-plan-data.zeabur.app/api';
  }

  async function identity(token, signal) {
    const res = await fetch(apiBase() + '/auth/me', {
      headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal,
    });
    if (!res.ok) {
      const error = new Error('驗證失敗');
      error.invalid = res.status === 401 || res.status === 403;
      throw error;
    }
    const body = await res.json();
    if (body.role !== expectedRole || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= realNow()) {
      const error = new Error('登入身分不符或已過期');
      error.invalid = true;
      throw error;
    }
    return body;
  }

  function checkStudent(body, slot, mode) {
    const fields = { grade: 'grade', caseId: 'case', school: 'school' };
    for (const [field, suffix] of Object.entries(fields)) {
      const slotValue = sessionStorage.getItem(`student${slot}_${suffix}`);
      const alias = slot === 1 ? sessionStorage.getItem(field) : null;
      const local = slotValue || (mode === 'single' ? alias : null);
      if (!body[field] || local !== body[field] || (alias && alias !== body[field])) throw Object.assign(new Error('學生身分不符'), { invalid: true });
    }
    const key = sessionStorage.getItem(`student${slot}_key`);
    if (key && key !== body.studentKey) throw Object.assign(new Error('學生編號不符'), { invalid: true });
  }

  async function loadScripts() {
    for (const placeholder of document.querySelectorAll('script[type="application/x-webgame-script"]')) {
      const script = document.createElement('script');
      if (placeholder.dataset.type) script.type = placeholder.dataset.type;
      if (placeholder.dataset.src) {
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          script.src = placeholder.dataset.src;
          placeholder.replaceWith(script);
        });
      } else {
        script.textContent = placeholder.textContent;
        placeholder.replaceWith(script);
      }
    }

  }

  async function validate() {
    hide();
    if (checking) return;
    checking = true;
    const attempt = ++generation;
    const controller = new AbortController();
    // Promise.race 也涵蓋讀取 body，超時後不允許遲來回應恢復頁面。
    let timeout;
    try {
      const role = sessionStorage.getItem('user_role');
      const mode = expectedRole === 'teacher' ? 'teacher' : sessionStorage.getItem('game_mode');
      if (role !== expectedRole || !['single', 'double', 'teacher'].includes(mode)) {
        home(null, false); return;
      }
      const tokens = expectedRole === 'teacher'
        ? [sessionStorage.getItem('token')]
        : mode === 'double'
          ? [sessionStorage.getItem('student1_token'), sessionStorage.getItem('student2_token')]
          : [sessionStorage.getItem('student1_token') || sessionStorage.getItem('token')];
      if (tokens.some((token) => !token)) { home(null, false); return; }
      const bodies = await Promise.race([
        Promise.all(tokens.map((token) => identity(token, controller.signal))),
        new Promise((_, reject) => { timeout = nativeTimeout(() => { controller.abort(); reject(new Error('驗證連線逾時')); }, 5000); }),
      ]);
      nativeClear(timeout);
      if (attempt !== generation) return;
      if (expectedRole === 'student') bodies.forEach((body, index) => checkStudent(body, index + 1, mode));
      const signature = JSON.stringify({ mode, tokens, bodies: bodies.map(({ expiresAt, ...body }) => body) });
      if (authenticated && authenticated.signature !== signature) { home(null, false); return; }
      if (expectedRole === 'student' && pageMode !== 'select' && mode !== pageMode) {
        const target = entry.dataset.doubleRedirect && mode === 'double'
          ? new URL(entry.dataset.doubleRedirect, global.location.href)
          : new URL('Select/index.html', root);
        global.location.replace(target.href); return;
      }
      authenticated = { signature, mode, tokens, bodies };
      global.WebGameAuth = {
        get active() { return !checking && !!authenticated && document.documentElement.style.visibility !== 'hidden'; },
        get session() { return authenticated; },
        invalidate() { authenticated = null; home('expired', true); },
        revalidate: validate,
      };
      const expires = Math.min(...bodies.map((body) => Date.parse(body.expiresAt)));
      sessionStorage.setItem('login_expires_at', String(expires));
      nativeClear(expiryTimer);
      expiryTimer = nativeTimeout(() => global.WebGameAuth.invalidate(), Math.max(0, expires - realNow()));
      if (expectedRole === 'teacher') {
        sessionStorage.setItem('teacher_id', String(bodies[0].teacherId));
        sessionStorage.setItem('teacher_name', bodies[0].teacherName);
        sessionStorage.setItem('teacher_school', bodies[0].school);
      }
      // 載入期間只有初次啟動可使用已驗證的登入，bfcache 必須等驗證完成。
      checking = false;
      document.documentElement.style.visibility = '';
      document.documentElement.inert = false;
      if (!bootPromise) bootPromise = loadScripts();
      await bootPromise;
      if (away) { hide(); return; }
      if (global.WebGameRuntime) global.WebGameRuntime.resume();
    } catch (error) {
      controller.abort();
      home(error.invalid ? 'expired' : 'retry', Boolean(error.invalid));
    } finally {
      nativeClear(timeout);
      checking = false;
    }
  }

  hide();
  for (const name of ['keydown', 'keyup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'submit']) {
    global.addEventListener(name, (event) => {
      if (document.documentElement.inert) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  global.addEventListener('pagehide', () => { away = true; hide(); });
  global.addEventListener('pageshow', (event) => { away = false; if (event.persisted) validate(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', validate, { once: true });
  else validate();
})(window);
