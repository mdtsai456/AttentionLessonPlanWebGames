import { test, expect } from '@playwright/test';

const SUBMIT_PATH = '/__test__/api/sessions';
const payload = { lessonId: 'DCCS', data: { caseId: 'T01', startTime: 1, endTime: 2 } };

// 只載入成績模組，使用瀏覽器原生 fetch、AbortController 與 localStorage。
test.beforeEach(async ({ page }) => {
  await page.route('**/__test__/client', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>DCCS client test</title>',
  }));
  await page.goto('/__test__/client');
  await page.evaluate(async () => {
    window.client = await import('/DCCS/js/net/client.js?v=2');
  });
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
    .toEqual([payload]);

  recover = true;
  expect(await page.evaluate((url) => window.client.flushPendingResults({ url }), SUBMIT_PATH))
    .toEqual({ attempted: 1, sent: 1, failed: 0, rejected: 0 });
  expect(await page.evaluate(() => window.client.listPendingResults())).toEqual([]);
  expect(posts).toEqual([payload, payload]);
});

test('回應本文卡住也會逾時，不能把未完成的回應當作成功', async ({ page }) => {
  await page.clock.install();
  await page.evaluate(({ payload, url }) => {
    // 模擬已收到 200 headers，但本文永遠不結束的伺服器。
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
    .toEqual([payload]);
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
    .toEqual([payload]);
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
