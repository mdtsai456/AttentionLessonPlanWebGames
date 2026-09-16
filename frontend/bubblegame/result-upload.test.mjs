import assert from 'node:assert/strict';
import test from 'node:test';

function element() {
  const listeners = new Map();
  const classes = new Set();
  return {
    listeners,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    dataset: {},
    value: '',
    textContent: '',
    disabled: false,
    addEventListener: (name, callback) => listeners.set(name, callback),
    setAttribute: () => {},
    checkValidity: () => true,
    reportValidity: () => {},
    click() { listeners.get('click')?.({ preventDefault() {}, stopImmediatePropagation() {} }); },
  };
}

test('uploads one single session and two paired double sessions', async () => {
  const ids = ['current-day-input', 'login-status', 'save-status', 'retry-save-button',
    'restart-button', 'start-single-button', 'start-multi-button'];
  const elements = Object.fromEntries(ids.map((id) => [id, element()]));
  const backLink = element();
  const events = new Map();
  const storage = new Map([
    ['student1_key', 'G1_S01'], ['student1_school', 'KMU'],
    ['student2_key', 'G2_S02'], ['student2_school', 'NTHU-01'],
  ]);
  const requests = [];
  elements['current-day-input'].value = '2';
  globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null };
  globalThis.document = {
    getElementById: (id) => elements[id],
    querySelector: () => backLink,
  };
  globalThis.window = {
    API_BASE_URL: 'http://127.0.0.1:5001/api',
    location: { hostname: '127.0.0.1', protocol: 'http:' },
    addEventListener: (name, callback) => events.set(name, callback),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ sessionId: String(requests.length) }) };
  };

  await import('./result-upload.js');
  const finish = events.get('bubblegame:finished');
  elements['start-single-button'].click();
  finish({ detail: { mode: 'single', players: [{ score: 2, totalRounds: 3 }] } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:5001/api/sessions');
  const single = JSON.parse(requests[0].options.body);
  assert.equal(single.data.mode, 'single');
  assert.equal(single.data.currentDay, 2);
  assert.equal(single.data.stats.find((item) => item.apiname === 'EFT_wrong').value, 1);

  elements['start-multi-button'].click();
  finish({ detail: { mode: 'double', players: [
    { score: 3, totalRounds: 4 }, { score: 1, totalRounds: 2 },
  ] } });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(requests.length, 3);
  const first = JSON.parse(requests[1].options.body);
  const second = JSON.parse(requests[2].options.body);
  assert.equal(first.data.mode, 'double');
  assert.equal(first.data.pairId, second.data.pairId);
  assert.equal(first.data.school, 'KMU');
  assert.equal(second.data.school, 'NTHU-01');
  assert.equal(second.data.stats.find((item) => item.apiname === 'EFT_correct').value, 1);

  let failSecond = true;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (JSON.parse(options.body).data.school === 'NTHU-01' && failSecond) {
      failSecond = false;
      throw new Error('offline');
    }
    return { ok: true, json: async () => ({ sessionId: String(requests.length) }) };
  };
  elements['start-multi-button'].click();
  finish({ detail: { mode: 'double', players: [
    { score: 1, totalRounds: 1 }, { score: 0, totalRounds: 1 },
  ] } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 5);
  assert.equal(elements['save-status'].dataset.state, 'error');

  elements['retry-save-button'].click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 6);
  assert.equal(JSON.parse(requests[5].options.body).data.school, 'NTHU-01');
  assert.equal(elements['save-status'].dataset.state, 'success');
});
