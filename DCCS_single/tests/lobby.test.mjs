// js/lobby.js resolveCurrentDay：「今天」以台灣時間（UTC+8）判斷，不跟著裝置時區。
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/New_York';

const RealDate = Date;
function freezeNow(iso) {
  const fixed = new RealDate(iso).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
}

globalThis.window = { API_BASE_URL: 'https://api.test/api', location: { hostname: 'example.test' } };

async function dayFor(mode, sessions) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ sessions }) });
  const { resolveCurrentDay } = await import(`../../DCCS_${mode}/js/lobby.js`);
  return resolveCurrentDay({ grade: 'G1', caseId: 'S01', school: 'A', token: 't' });
}

for (const mode of ['single', 'double']) {
  test(`${mode}：裝置在美東，台灣已是隔天時，昨天（台灣）的場次不算今天`, async () => {
    // 現在：UTC 7/1 17:00 = 台灣 7/2 01:00 = 美東 7/1 13:00。
    freezeNow('2026-07-01T17:00:00Z');
    // 場次：UTC 7/1 15:00 = 台灣 7/1 23:00（台灣的昨天）= 美東 7/1 11:00（美東的今天）。
    const day = await dayFor(mode, [{ currentDay: 5, startTime: '2026-07-01 15:00:00' }]);
    globalThis.Date = RealDate;
    assert.equal(day, 6);
  });

  test(`${mode}：台灣同一天玩過的場次沿用那一天`, async () => {
    // 現在：台灣 7/2 01:00；場次：UTC 7/1 16:30 = 台灣 7/2 00:30。
    freezeNow('2026-07-01T17:00:00Z');
    const day = await dayFor(mode, [{ currentDay: 5, startTime: '2026-07-01 16:30:00' }]);
    globalThis.Date = RealDate;
    assert.equal(day, 5);
  });
}
