// 純函式的規則判斷（SPEC 4.9）。關卡指定物件規則，不從選項內容推導。

/**
 * @param {{kind: 'shape'|'object', items: Array<object>}} valve
 * @param {'model'|'category'} objectRule 關卡指定的物件閥規則，見 game/levels.json、SPEC 1.4/1.5。
 *   valve.kind === 'shape' 時，不使用此參數。形狀閥固定使用 'frame'。
 * @returns {'frame'|'category'|'model'}
 */
export function ruleForValve(valve, objectRule) {
  if (valve.kind === 'shape') return 'frame';

  // 規則無效時立即拋出錯誤，避免將 category 題記為 model 題。
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
    return !!target.content && (
      answer.id === target.content.id ||
      answer.categoryId === target.content.categoryId
    );
  }
  if (rule === 'model') {
    return !!target.content && answer.id === target.content.id;
  }
  throw new Error(`isCorrect: unknown rule "${rule}"`);
}
