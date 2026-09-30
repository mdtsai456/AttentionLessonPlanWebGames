// 專心達標的煙火動畫：煙火放滿整個畫面，下方置中顯示提示文字，右上角 ✕ 關閉。
// 用法：window.showFireworks("聽說這裡有專心的小朋友，原來是你！")，回傳 Promise，關閉時 resolve。
// 點 ✕、按 Esc 或 15 秒後自動關閉。系統開啟「減少動態效果」時只顯示文字。
(function () {
  const script = document.currentScript;
  const base = new URL("./", script.src);
  const AUTO_CLOSE_MS = 15000;
  const LAUNCH_EVERY_MS = 160;
  const GRAVITY = 0.04;
  const COLORS = ["#ff7eb6", "#ffd23f", "#7ad7ff", "#c792ff", "#ff9f5a", "#9ef07a", "#ffffff"];

  let root = null;
  let canvas = null;
  let ctx = null;
  let textEl = null;
  let closeBtn = null;
  let pending = null;
  let rockets = [];
  let sparks = [];
  let frameId = 0;
  let lastLaunch = 0;
  let closeTimer = 0;

  function ensure() {
    if (root) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("fireworks.css", base).href;
    document.head.appendChild(link);

    root = document.createElement("div");
    root.className = "shared-fireworks";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "shared-fireworks-text");
    // 焦點放在整層而不是 ✕，一打開時才不會出現鍵盤焦點框；按 Tab 仍可移到 ✕
    root.tabIndex = -1;
    root.innerHTML =
      '<canvas class="shared-fireworks-canvas" aria-hidden="true"></canvas>' +
      '<button class="shared-fireworks-close" type="button" aria-label="關閉">✕</button>' +
      '<p class="shared-fireworks-text" id="shared-fireworks-text"></p>';
    document.body.appendChild(root);
    canvas = root.querySelector(".shared-fireworks-canvas");
    ctx = canvas.getContext("2d");
    textEl = root.querySelector(".shared-fireworks-text");
    closeBtn = root.querySelector(".shared-fireworks-close");
    closeBtn.addEventListener("click", close);
    window.addEventListener("keydown", (event) => {
      if (root.hidden || event.code !== "Escape") return;
      event.preventDefault();
      close();
    });
    window.addEventListener("resize", resize);
  }

  /** 以第一個「，」拆成兩行：前半小字鋪陳，後半大字揭曉。沒有「，」就整句用大字。 */
  function renderMessage(message) {
    const index = message.indexOf("，");
    const lead = index === -1 ? "" : message.slice(0, index + 1);
    const reveal = index === -1 ? message : message.slice(index + 1);
    textEl.replaceChildren();
    if (lead) {
      const small = document.createElement("span");
      small.className = "shared-fireworks-lead";
      small.textContent = lead;
      textEl.appendChild(small);
    }
    const big = document.createElement("span");
    big.className = "shared-fireworks-reveal";
    big.textContent = reveal;
    textEl.appendChild(big);
  }

  function resize() {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function launch() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const targetY = height * (0.06 + Math.random() * 0.7);
    rockets.push({
      x: width * (0.04 + Math.random() * 0.92),
      y: height,
      // 飛到 targetY 大約要 40～55 格，炸開高度才能分布到整個畫面
      vy: -(height - targetY) / (40 + Math.random() * 15),
      targetY,
      color: pick(COLORS),
    });
  }

  function burst(rocket) {
    const count = 70 + Math.floor(Math.random() * 40);
    // 爆炸半徑跟著畫面大小走，大螢幕也能鋪滿
    const speed = Math.min(window.innerWidth, window.innerHeight) * (0.006 + Math.random() * 0.004);
    const second = pick(COLORS);
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const power = speed * (0.55 + Math.random() * 0.45);
      sparks.push({
        x: rocket.x,
        y: rocket.y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power,
        life: 1,
        decay: 0.009 + Math.random() * 0.008,
        color: i % 3 === 0 ? second : rocket.color,
      });
    }
  }

  function tick(time) {
    if (time - lastLaunch > LAUNCH_EVERY_MS) {
      launch();
      if (Math.random() < 0.4) launch();
      lastLaunch = time;
    }

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = "lighter";

    rockets = rockets.filter((rocket) => {
      rocket.y += rocket.vy;
      ctx.fillStyle = rocket.color;
      ctx.beginPath();
      ctx.arc(rocket.x, rocket.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (rocket.y <= rocket.targetY) {
        burst(rocket);
        return false;
      }
      return true;
    });

    sparks = sparks.filter((spark) => {
      spark.vx *= 0.985;
      spark.vy = spark.vy * 0.985 + GRAVITY;
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.life -= spark.decay;
      if (spark.life <= 0) return false;
      ctx.globalAlpha = spark.life;
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    frameId = window.requestAnimationFrame(tick);
  }

  function stopAnimation() {
    window.cancelAnimationFrame(frameId);
    frameId = 0;
    rockets = [];
    sparks = [];
    if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function close() {
    if (!pending) return;
    const resolve = pending;
    pending = null;
    window.clearTimeout(closeTimer);
    stopAnimation();
    root.hidden = true;
    resolve();
  }

  window.showFireworks = function showFireworks(message) {
    ensure();
    if (pending) return Promise.resolve();
    renderMessage(message || "聽說這裡有專心的小朋友，原來是你！");
    root.hidden = false;
    root.focus();

    const reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) {
      resize();
      lastLaunch = 0;
      frameId = window.requestAnimationFrame(tick);
    }
    closeTimer = window.setTimeout(close, AUTO_CLOSE_MS);

    return new Promise((resolve) => {
      pending = resolve;
    });
  };
})();
