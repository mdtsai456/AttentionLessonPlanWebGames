// E2E 共用斷言
import assert from 'node:assert/strict';
import { hintFor } from './helpers.js';

const STREAK_TO_EVOLVE = 5;

/**
 * 成功作答後的回饋檢查
 * @param {object} r playQuestion 回傳的單一玩家結果
 * @param {number} streak 這題答完後的連擊數
 * @param {{ atMaxAfter: boolean, image: string }} expected 答完後是否已是最高級、應顯示的動物圖
 */
export function expectSuccess(r, streak, { atMaxAfter, evolved = false, image }, label = '') {
  const where = `${label} 連擊 ${streak}：${r.message}`;
  assert.match(r.message, /^(瞄準且答對|正確等待且保持瞄準)！＋1 分/, where);
  assert.equal(r.mark, 'correct', where);
  assert.equal(r.image, image, where);
  assert.doesNotMatch(r.message, /連擊歸零/, where);
  if (streak % STREAK_TO_EVOLVE === 0) {
    assert.doesNotMatch(r.message, /再連續答對/, where);
    if (evolved) assert.match(r.message, new RegExp(`🎉 連續答對 ${streak} 題！變身新動物！$`), where);
    else assert.match(r.message, new RegExp(`🎉 連續答對 ${streak} 題！維持最高級動物狀態！$`), where);
  } else if (atMaxAfter) {
    assert.doesNotMatch(r.message, /再連續答對|🎉/, where);
  } else {
    assert.ok(r.message.endsWith(hintFor(STREAK_TO_EVOLVE - (streak % STREAK_TO_EVOLVE))), where);
  }
}

/**
 * 失敗後的回饋檢查：動物不降級、紅光、有連擊時才提示「連擊歸零」
 */
export function expectFailure(r, { hadStreak, offTarget = false, image }, label = '') {
  const where = `${label}：${r.message}`;
  if (offTarget) assert.match(r.message, /^判斷正確，但準心未對到動物，不計分/, where);
  else assert.match(r.message, /^(漏答：正確的題目要按 |誤按：不正確的題目不需要按鍵)/, where);
  assert.equal(r.mark, 'wrong', `${where}（應出現紅光）`);
  assert.equal(r.image, image, `${where}（動物不應降級）`);
  assert.doesNotMatch(r.message, /再連續答對|🎉/, where);
  if (hadStreak) assert.ok(r.message.endsWith('（連擊歸零）'), where);
  else assert.doesNotMatch(r.message, /連擊歸零/, where);
}

export function expectNoErrors(session) {
  assert.deepEqual(session.errors, [], `頁面不應有錯誤：\n${session.errors.join('\n')}`);
}

/**
 * 新規則的參考模型：連續 5 題升級一次，失敗只歸零連擊、不降級
 */
export class AnimalModel {
  constructor(images) {
    this.images = images;
    this.level = 0;
    this.streak = 0;
  }

  get image() {
    return this.images[this.level];
  }

  success() {
    this.streak++;
    let evolved = false;
    if (this.streak % STREAK_TO_EVOLVE === 0 && this.level < this.images.length - 1) {
      this.level++;
      evolved = true;
    }
    return { streak: this.streak, evolved, atMaxAfter: this.level === this.images.length - 1, image: this.image };
  }

  failure(offTarget = false) {
    const hadStreak = this.streak > 0;
    this.streak = 0;
    return { hadStreak, offTarget, image: this.image };
  }

  // 依動作推進模型並檢查實際結果
  check(action, r, label) {
    if (action === 'correct') {
      const e = this.success();
      expectSuccess(r, e.streak, e, label);
    } else {
      expectFailure(r, this.failure(action === 'offTarget'), label);
    }
  }
}

/**
 * 雙人版：判定訊息要真的顯示在畫面上（作答中直接顯示，逾時後以「上一題：」顯示）。
 * 例外是關卡或練習結束時，畫面改顯示過關或練習結束訊息。
 */
export function expectVisibleFeedback(r, label = '') {
  const v = r.visibleFeedback;
  const ok = v === r.message || v === `上一題：${r.message}` || /^(第 \d+ 關已結束|恭喜通過第 \d+ 關|練習結束)/.test(v);
  assert.ok(ok, `${label}：畫面顯示「${v}」，判定訊息為「${r.message}」`);
}
