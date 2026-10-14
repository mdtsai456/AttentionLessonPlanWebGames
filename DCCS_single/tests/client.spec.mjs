import { test, expect } from '@playwright/test';

const SUBMIT_PATH = '/__test__/api/sessions';
const payload = { lessonId: 'DCCS', data: { caseId: 'T01', startTime: 1, endTime: 2 } };
// 送出時會補上 submissionId，其餘內容不變。
const sentPayload = { ...payload, data: { ...payload.data, submissionId: expect.any(String) } };

// 只載入成績模組與它用到的 shared/api.js（submissionId 用 WebGameApi.uuid），
// 使用瀏覽器原生 fetch、AbortController 與 localStorage。?runtime 時另外載入遊戲時鐘。
async function openClientPage(page, { runtime = false } = {}) {
  await page.route('**/__test__/client*', (route) => {
    const withRuntime = new URL(route.request().url()).searchParams.has('runtime');
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>DCCS client test</title>'
        + (withRuntime ? '<script src="/shared/game-runtime.js"></script>' : '')
        + '<script src="/shared/api.js"></script>',
    });
  });
  await page.goto(runtime ? '/__test__/client?runtime' : '/__test__/client');
  await page.evaluate(async () => {
    // 沒有登入資料：只留 uuid，送出走一般 fetch，不走 WebGameApi.submitSession。
    window.WebGameApi = { uuid: window.WebGameApi.uuid };
    window.client = await import('/DCCS_single/js/net/client.js?v=4');
  });
}

test.beforeEach(async ({ page }) => {
  await openClientPage(page);
});

test('送出逾時會暫存；重送成功才刪除原始成績', async ({ page }) => {
  const posts = [];
  let recover = false;
  await page.route(`**${SUBMIT_PATH}`, async (route) => {
    posts.push(route.request().postDataJSON());
    if (recover) await route.fulfill({ status: 200, body: '{}' });
  });
  await page.clock.install();
  const request = page.waitForRequest(`**${SUBMIT_PATH}`);
  await page.evaluate(({ payload, url }) => {
    window.result = null;
    void window.client.submitResult(payload, { url }).then((result) => { window.result = result; });
  }, { payload, url: SUBMIT_PATH });
  await request;
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.result?.ok)).toBe(false);
  expect(await page.evaluate(() => window.client.listPendingResults().map((p) => p.payload)))
    .toEqual([sentPayload]);

  recover = true;
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toEqual({ attempted: 1, sent: 1, failed: 0, rejected: 0 });
  expect(await page.evaluate(() => window.client.listPendingResults())).toEqual([]);
  expect(posts).toEqual([sentPayload, sentPayload]);
});

test('回應本文卡住也會逾時，不能把未完成的回應當作成功', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(({ payload, url }) => {
    // 模擬回傳 200 headers 後，持續等待回應本文的伺服器。
    window.fetch = async (_url, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => {
          controller.error(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      },
    }), { status: 200 });
    window.result = null;
    void window.client.submitResult(payload, { url }).then((result) => { window.result = result; });
  }, { payload, url: SUBMIT_PATH });
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.result?.ok)).toBe(false);
  expect(await page.evaluate(() => window.client.listPendingResults().map((p) => p.payload)))
    .toEqual([sentPayload]);
});

test('暫時失敗不增加待送筆數；永久拒絕保留原始資料供人工處理', async ({ page }) => {
  let status = 500;
  await page.route(`**${SUBMIT_PATH}`, (route) => route.fulfill({ status, body: 'unavailable' }));
  expect(await page.evaluate(({ payload, url }) => window.client.submitResult(payload, { url }),
    { payload, url: SUBMIT_PATH })).toMatchObject({ ok: false });
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toEqual({ attempted: 1, sent: 0, failed: 1, rejected: 0 });
  expect(await page.evaluate(() => window.client.listPendingResults())).toHaveLength(1);

  status = 400;
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toEqual({ attempted: 1, sent: 0, failed: 0, rejected: 1 });
  expect(await page.evaluate(() => window.client.listPendingResults())).toEqual([]);
  expect(await page.evaluate(() => window.client.listRejectedResults().map((p) => p.payload)))
    .toEqual([sentPayload]);
});

test('瀏覽器不允許本機儲存時，送出失敗仍能回傳結果', async ({ page }) => {
  await page.route(`**${SUBMIT_PATH}`, (route) => route.abort());
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', { get() {
      throw new DOMException('Storage unavailable', 'SecurityError');
    } });
  });
  expect(await page.evaluate(({ payload, url }) => window.client.submitResult(payload, { url }),
    { payload, url: SUBMIT_PATH })).toMatchObject({ ok: false });
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toEqual({ attempted: 0, sent: 0, failed: 0, rejected: 0 });
});

test('逾時後重送沿用同一個 submissionId，後端才能認出是同一筆', async ({ page }) => {
  const posts = [];
  let recover = false;
  await page.route(`**${SUBMIT_PATH}`, async (route) => {
    posts.push(route.request().postDataJSON());
    // 第一次：伺服器其實已寫入，但回應太慢讓前端逾時。
    if (recover) await route.fulfill({ status: 201, body: '{}' });
  });
  await page.clock.install();
  const request = page.waitForRequest(`**${SUBMIT_PATH}`);
  await page.evaluate(({ payload, url }) => {
    window.result = null;
    window.inputPayload = payload;
    void window.client.submitResult(payload, { url }).then((result) => { window.result = result; });
  }, { payload, url: SUBMIT_PATH });
  await request;
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.result?.ok)).toBe(false);

  recover = true;
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toMatchObject({ sent: 1 });
  expect(posts).toHaveLength(2);
  const [first, retry] = posts.map((post) => post.data.submissionId);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(retry).toBe(first);
  // 呼叫端傳進來的物件不被改動。
  expect(await page.evaluate(() => 'submissionId' in window.inputPayload.data)).toBe(false);
});

test('submissionId 由 WebGameApi.uuid 產生（全站共用的 UUID 產生器）', async ({ page }) => {
  const posts = [];
  await page.route(`**${SUBMIT_PATH}`, async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, body: '{}' });
  });
  await page.evaluate(() => {
    window.WebGameApi.uuid = () => '11111111-2222-4333-8444-555555555555';
  });
  expect(await page.evaluate(({ payload, url }) => window.client.submitResult(payload, { url }),
    { payload, url: SUBMIT_PATH })).toMatchObject({ ok: true });
  expect(posts.map((post) => post.data.submissionId))
    .toEqual(['11111111-2222-4333-8444-555555555555']);
});

test('遊戲暫停中（例如確定離開後）送出仍會逾時：逾時不能用會被暫停的遊戲計時器', async ({ page }) => {
  // 時鐘要在 game-runtime.js 載入前裝好，它保留下來的原生計時器才是可快轉的假時鐘。
  await page.clock.install();
  await openClientPage(page, { runtime: true });
  await page.route(`**${SUBMIT_PATH}`, () => {});
  const request = page.waitForRequest(`**${SUBMIT_PATH}`);
  await page.evaluate(({ payload, url }) => {
    window.WebGameRuntime.pause('leave-confirm');
    window.result = null;
    void window.client.submitResult(payload, { url }).then((result) => { window.result = result; });
  }, { payload, url: SUBMIT_PATH });
  await request;
  await page.clock.fastForward(15_001);
  await expect.poll(() => page.evaluate(() => window.result?.ok)).toBe(false);
  expect(await page.evaluate(() => window.WebGameRuntime.paused)).toBe(true);
  expect(await page.evaluate(() => window.client.listPendingResults().map((p) => p.payload)))
    .toEqual([sentPayload]);
});
