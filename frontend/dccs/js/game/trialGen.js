// 關卡可行性、固定素材組與出題器（SPEC 4.10）。
// shapeCount 與 objectCount 獨立；所有隨機性使用注入的 rng。

/**
 * 依類別 id 找到 manifest.categories 裡對應的那一項；找不到回傳 null。
 * @param {object} manifest
 * @param {string} id
 * @returns {object|null}
 */
function categoryById(manifest, id) {
  const categories = Array.isArray(manifest.categories) ? manifest.categories : [];
  return categories.find((c) => c.id === id) || null;
}

/**
 * 判斷關卡指定素材能否同時支援 frame 與 object 題。
 *
 * @param {object} manifest
 * @param {{shapeCount: number, objectCount: number, objectRule: 'model'|'category',
 *          sourceCategory?: string, sourceCategories?: Array<string>}} level
 * @returns {{ frame: boolean, object: boolean, ok: boolean, reason: string|null }}
 */
export function levelFeasibility(manifest, level) {
  const shapeCount = level.shapeCount;
  const objectCount = level.objectCount;
  const shapes = Array.isArray(manifest.shapes) ? manifest.shapes : [];

  const frame = shapes.length >= shapeCount;

  const reasons = [];
  if (!frame) {
    reasons.push(`frame needs ${shapeCount} shapes, have ${shapes.length}`);
  }

  let object;
  if (level.objectRule === 'model') {
    // 素材不足回報不可玩；設定格式錯誤才由 manifest 產生器攔截。
    const cat = categoryById(manifest, level.sourceCategory);
    if (!cat) {
      object = false;
      reasons.push(`model source category "${level.sourceCategory}" not found`);
    } else {
      const count = Array.isArray(cat.images) ? cat.images.length : 0;
      object = count >= objectCount;
      if (!object) {
        reasons.push(
          `model source category "${level.sourceCategory}" needs ${objectCount} images, have ${count}`
        );
      }
    }
  } else if (level.objectRule === 'category') {
    // 防禦性檢查陣列長度與每個類別是否存在。
    const ids = Array.isArray(level.sourceCategories) ? level.sourceCategories : [];
    const missing = ids.filter((id) => !categoryById(manifest, id));
    const lengthOk = ids.length === objectCount;
    object = lengthOk && missing.length === 0;
    if (!lengthOk) {
      reasons.push(`category needs sourceCategories length ${objectCount}, have ${ids.length}`);
    }
    if (missing.length > 0) {
      reasons.push(
        `category source categories not found: ${missing.map((id) => `"${id}"`).join(', ')}`
      );
    }
  } else {
    throw new Error(`levelFeasibility: invalid objectRule "${level.objectRule}"`);
  }

  const ok = frame && object;
  return { frame, object, ok, reason: ok ? null : reasons.join('; ') };
}

/**
 * 建立整關共用的固定素材組（SPEC 1.7）。順序以 manifest 為準；category
 * 關的 objects 是各類別代表圖，targetObjects 則包含各類別全部圖片。
 *
 * @param {object} manifest
 * @param {{shapeCount: number, objectCount: number, objectRule: 'model'|'category',
 *          sourceCategory?: string, sourceCategories?: Array<string>}} level
 * @returns {{shapes: Array<object>, objects: Array<object>, targetObjects: Array<object>}|null}
 *   不可行回傳 null。
 */
export function buildLevelDeck(manifest, level) {
  const feas = levelFeasibility(manifest, level);
  if (!feas.ok) return null;

  const shapeCount = level.shapeCount;
  const objectCount = level.objectCount;
  const shapes = Array.isArray(manifest.shapes) ? manifest.shapes : [];
  const deckShapes = shapes.slice(0, shapeCount);

  let deckObjects;
  let targetObjects;
  if (level.objectRule === 'model') {
    // 類別即使有更多素材，閥門仍固定使用前 objectCount 張。
    const cat = categoryById(manifest, level.sourceCategory);
    deckObjects = cat.images.slice(0, objectCount);
    targetObjects = deckObjects;
  } else {
    // 每個類別的第一張圖固定作為閥門代表。
    deckObjects = level.sourceCategories.map((id) => {
      const cat = categoryById(manifest, id);
      return cat.images[0];
    });
    // 目標池涵蓋所有圖片，next() 以洗牌袋避免一輪內重複。
    targetObjects = level.sourceCategories.flatMap((id) => {
      const cat = categoryById(manifest, id);
      return cat.images;
    });
  }

  return { shapes: deckShapes, objects: deckObjects, targetObjects };
}

/**
 * Fisher-Yates 洗牌，透過注入的 rng 取得隨機性，不動原陣列。
 * @param {() => number} rng
 * @param {Array<object>} arr
 * @returns {Array<object>}
 */
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function pickIndex(rng, length) {
  return Math.min(length - 1, Math.floor(rng() * length));
}

/**
 * @param {object} manifest 保留於公開 API；素材由 deck 提供
 * @param {() => number} rng
 * @returns {{ next(level: object, deck: object|null): object|null }}
 */
export function createTrialGenerator(manifest, rng) {
  // 每個 deck 有獨立洗牌袋，不共享跨實例狀態。
  const categoryTargetBags = new WeakMap();

  function nextCategoryTarget(deck) {
    let bag = categoryTargetBags.get(deck);
    if (!bag || bag.length === 0) {
      bag = shuffle(rng, deck.targetObjects);
      categoryTargetBags.set(deck, bag);
    }
    return bag.pop();
  }

  /**
   * 洗牌兩道閥門並挑選目標；category 目標一輪內不重複。
   * @param {{levelNo: number, shapeCount: number, objectCount: number,
   *          objectRule: 'model'|'category'}} level manifest.levels 的一整項。
   * @param {{shapes: Array<object>, objects: Array<object>, targetObjects: Array<object>}|null} deck
   *   buildLevelDeck() 的回傳值；該關不可行時為 null。
   * @returns {object|null} Trial，見 SPEC 4.10；deck 為 null 時回傳 null。
   */
  function next(level, deck) {
    if (!deck) return null;

    const shapeItems = shuffle(rng, deck.shapes);
    const objectItems = shuffle(rng, deck.objects);

    const target = {
      frame: shapeItems[pickIndex(rng, shapeItems.length)],
      content:
        level.objectRule === 'category'
          ? nextCategoryTarget(deck)
          : objectItems[pickIndex(rng, objectItems.length)],
    };

    return {
      type: 'compound',
      levelNo: level.levelNo,
      shapeCount: level.shapeCount,
      objectCount: level.objectCount,
      target,
      shapeItems,
      objectItems,
      objectRule: level.objectRule,
    };
  }

  return { next };
}
