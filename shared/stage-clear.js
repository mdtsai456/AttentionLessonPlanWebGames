(function () {
  const script = document.currentScript;
  const base = new URL('./', script.src);
  let root = null;
  let titleEl = null;
  let button = null;
  let pending = null;

  function ensure() {
    if (root) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('stage-clear.css', base).href;
    document.head.appendChild(link);

    root = document.createElement('div');
    root.className = 'shared-stage-clear';
    root.hidden = true;
    root.innerHTML =
      '<section class="shared-stage-clear-card" role="dialog" aria-modal="true">' +
      '<div class="shared-stage-clear-badge"></div>' +
      '<p class="shared-stage-clear-text">準備開始下一關嘍！</p>' +
      '<button class="shared-stage-clear-btn" type="button">繼續</button>' +
      '</section>';
    document.body.appendChild(root);
    titleEl = root.querySelector('.shared-stage-clear-badge');
    button = root.querySelector('.shared-stage-clear-btn');
    button.addEventListener('click', close);
    window.addEventListener('keydown', (event) => {
      if (root.hidden) return;
      if (event.code !== 'Enter' && event.code !== 'NumpadEnter' && event.code !== 'Space') return;
      event.preventDefault();
      close();
    });
  }

  function close() {
    if (!pending) return;
    const resolve = pending.resolve;
    pending = null;
    root.hidden = true;
    resolve();
  }

  window.showStageClear = function showStageClear(level) {
    ensure();
    const stage = Number(level) || 1;
    if (pending && pending.level === stage) return pending.promise;
    titleEl.textContent = `第 ${stage} 關結束`;
    root.hidden = false;
    button.focus();
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    pending = { level: stage, promise, resolve };
    return promise;
  };
})();
