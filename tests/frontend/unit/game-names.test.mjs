// 選單與老師後台的遊戲名稱（shared/api.js 的 GAMES）要和說明頁標題一致，
// 避免學生在選單看到一個名字、進了遊戲又看到另一個。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE_ROOT } from '../site.mjs';

const window = {};
vm.runInNewContext(fs.readFileSync(`${SITE_ROOT}/shared/api.js`, 'utf8'), { window });
const { GAMES } = window.WebGameApi;

/** 讀出 HTML 的 <title>，去掉共同的前綴與「・遊戲說明」等後綴，只留遊戲名稱。 */
function gameNameInTitle(path) {
  const html = fs.readFileSync(`${SITE_ROOT}/${path}`, 'utf8');
  const title = html.match(/<title>(.*?)<\/title>/)[1];
  return title.replace('Attention Lesson Plan - ', '').split('・')[0];
}

for (const game of GAMES) {
  test(`${game.id} 的選單名稱和說明頁標題一致`, () => {
    assert.equal(gameNameInTitle(`Tutorial/${game.id}_tutorial.html`), game.name);
  });
}

test('動物追擊令單人與雙人遊戲畫面的標題和選單名稱一致', () => {
  const dat = GAMES.find((game) => game.id === 'DAT');
  for (const path of ['DAT_single/DAT_single.html', 'DAT_double/DAT_double.html']) {
    const html = fs.readFileSync(`${SITE_ROOT}/${path}`, 'utf8');
    const labels = [...html.matchAll(/class="progress-label">(.*?)</g)].map((match) => match[1]);
    assert.ok(labels.length > 0, `${path} 找不到 progress-label`);
    for (const label of labels) assert.equal(label, dat.name, path);
  }
});
