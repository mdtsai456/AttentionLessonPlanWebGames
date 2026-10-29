import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

function resolve(location, override) {
  const window = { location, API_BASE_URL: override };
  vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api-base.js`, 'utf8'), { window });
  return window.resolveApiBase();
}

test('有 API_BASE_URL 就用它，並去掉結尾斜線，避免送到 //sessions', () => {
  assert.equal(resolve({ pathname: '/Select/index.html', hostname: 'example.test' }, 'https://override.test/api///'), 'https://override.test/api');
});

test('/app/ 底下用同一個 origin 的 /api', () => {
  assert.equal(resolve({ pathname: '/app/Select/index.html', hostname: 'host.test', origin: 'https://host.test' }), 'https://host.test/api');
});

test('localhost 與 127.0.0.1 打到同一台機器的 5001', () => {
  assert.equal(resolve({ pathname: '/Select/index.html', hostname: 'localhost', protocol: 'http:' }), 'http://localhost:5001/api');
  assert.equal(resolve({ pathname: '/Select/index.html', hostname: '127.0.0.1', protocol: 'http:' }), 'http://127.0.0.1:5001/api');
});

test('其他網址打正式後端', () => {
  assert.equal(resolve({ pathname: '/Home/index.html', hostname: 'attention-webgames.zeabur.app' }), 'https://attention-lesson-plan-data.zeabur.app/api');
});

test('後端位址只在 api-base.js 判斷，其他檔案不再各寫一份', () => {
  for (const file of ['shared/api.js', 'shared/require-student.js', 'shared/session-timeout.js', 'DCCS_single/js/net/apiBase.js', 'DCCS_double/js/net/apiBase.js']) {
    const text = fs.readFileSync(`${SITE_ROOT}/${file}`, 'utf8');
    assert.doesNotMatch(text, /zeabur\.app|:5001/, file);
  }
});
