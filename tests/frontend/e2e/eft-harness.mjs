// shared/eft-player.js 的最小測試畫面：直接建立玩家，搭配 page.clock 精確控制每一題的時間點。
// window.ended 記錄每次關卡結束時的狀態。

const HARNESS = `<!doctype html><html><body>
<div id="root">
  <div role="progressbar"><div data-ui="progress-fill"></div></div>
  <div data-ui="round"></div><strong data-ui="score"></strong>
  <div data-ui="bubble-field"></div>
  <section class="answer-panel"><p data-ui="feedback"></p></section>
  <button data-direction="left" disabled></button><button data-direction="right" disabled></button>
  <div data-ui="results" hidden><strong data-ui="final-score"></strong><p data-ui="accuracy"></p><button data-ui="restart"></button></div>
</div>
<script src="/shared/game-runtime.js"></script>
<script type="module">
  import { createEftPlayer } from '/shared/eft-player.js';
  const root = document.getElementById('root');
  window.ended = [];
  window.player = createEftPlayer({
    root,
    getUi: (id) => root.querySelector('[data-ui="' + id + '"]'),
    onStageEnd: ({ stage }) => { window.ended.push({ stage, state: window.player.getState() }); },
  });
</script>
</body></html>`;

export async function openHarness(page) {
  await page.route('**/__eft-player-harness.html', (route) => route.fulfill({ contentType: 'text/html', body: HARNESS }));
  await page.clock.install();
  await page.goto('__eft-player-harness.html');
  await page.waitForFunction(() => !!window.player);
  // 停住時間，之後只靠 runFor 前進。
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => window.player.startGame());
}
