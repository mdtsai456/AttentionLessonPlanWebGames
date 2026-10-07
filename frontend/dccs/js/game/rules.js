// 純函式規則判斷（SPEC 4.9）。物件規則由關卡指定，不從選項內容推導。

/**
 * @param {{kind: 'shape'|'object', items: Array<object>}} valve
 * @param {'model'|'category'} objectRule 該題所屬關卡指定的物件閥規則
 *   （見 game/levels.json、SPEC 1.4/1.5）。valve.kind === 'shape' 時不使用
 *   這個參數（形狀閥永遠是 'frame'）。
 * @returns {'frame'|'category'|'model'}
 */
export function ruleForValve(valve, objectRule) {
  if (valve.kind === 'shape') return 'frame';

  // 非法規則應立即失敗，避免把 category 題誤記為 model。
  if (objectRule !== 'model' && objectRule !== 'category') {
    throw new Error(`ruleForValve: invalid objectRule "${objectRule}"`);
  }
  return objectRule;
}

/**
 * @param {'frame'|'category'|'model'} rule
 * @param {{frame: object|null, content: object|null}} target
 * @param {object} answer
 * @returns {boolean}
 */
export function isCorrect(rule, target, answer) {
  if (rule === 'frame') {
    return !!target.frame && answer.id === target.frame.id;
  }
  if (rule === 'category') {
    return !!target.content && answer.categoryId === target.content.categoryId;
  }
  if (rule === 'model') {
    return !!target.content && answer.id === target.content.id;
  }
  throw new Error(`isCorrect: unknown rule "${rule}"`);
}
