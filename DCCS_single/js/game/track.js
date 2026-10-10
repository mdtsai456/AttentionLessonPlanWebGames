// 單一玩家賽道（SPEC 4.12）。建構子接收所有狀態，以建立雙人模式的獨立實例。
// 每關使用固定素材。換關前，等待目前題目離場。題目產生時固定其屬性。
import { CONFIG } from '../config.js';
import { Valve } from './valve.js';
import { createTarget, stepTarget, hasReachedZ } from './target.js';
import { ruleForValve, isCorrect } from './rules.js';
import { createTrialGenerator, buildLevelDeck } from './trialGen.js';
import { drawBackground, drawSprite } from '../render/road.js';
import { targetSizeAt } from '../render/projection.js';
import { drawHud } from '../render/hud.js';

const RETRY_INTERVAL_SECONDS = 0.5;

export class Track {
  /**
   * @param {{manifest: object, images: Map<string, HTMLImageElement>, input: object,
   *          viewport: {x:number,y:number,w:number,h:number}, rng: () => number, stats: object,
   *          backgroundKey?: string, sessionSeconds?: number}} opts
   */
  constructor({
    manifest,
    images,
    input,
    viewport,
    rng,
    stats,
    backgroundKey = 'single',
    sessionSeconds = CONFIG.SESSION_SECONDS,
  }) {
    this.manifest = manifest;
    this.images = images;
    this.input = input;
    this.viewport = viewport;
    this.rng = rng;
    this.stats = stats;
    this.backgroundKey = backgroundKey;
    this.sessionSeconds = sessionSeconds;

    this.levels = Array.isArray(manifest.levels) ? manifest.levels.slice() : [];
    this.trialGen = createTrialGenerator(manifest, rng);

    // 每關平均分配場次時間；無關卡時避免除以零。
    this._levelSeconds =
      this.levels.length > 0 ? this.sessionSeconds / this.levels.length : this.sessionSeconds;

    this._score = 0;
    this._elapsed = 0;
    this._levelIdx = 0;
    this._levelElapsed = 0;
    this._levelAdvancePending = false;

    this._tickTimer = 0;
    this._showTick = false;

    this._target = null;
    // 使用出題時固定的屬性判定答案，不讀取目前關卡的屬性。
    this._trialLevelNo = null;
    this._trialShapeCount = null;
    this._trialObjectCount = null;
    this._trialObjectRule = null;
    this._valveShape = null;
    this._valveObject = null;

    // 按鍵時間以 target.ageMs 為共同基準，每次出題時重置。
    this._shapePressCount = 0;
    this._shapeFirstPressAgeMs = null;
    this._shapeLastPressAgeMs = null;
    this._objectPressCount = 0;
    this._objectFirstPressAgeMs = null;
    this._objectLastPressAgeMs = null;

    this._warnedNoTrial = false;
    this._retryTimer = 0;

    this._trialCounter = -1;
    this._currentTrialIndex = null;
    // 每題的兩道閥皆答對才算答對。逐閥記錄判定，逐題計分並顯示 ✓。
    this._trialAllCorrect = true;
    this._trialFinalized = false;

    // 每關只建立一次固定素材組。
    this._levelDeck =
      this.levels.length > 0 ? buildLevelDeck(this.manifest, this.levels[this._levelIdx]) : null;

    this._spawnTrial();
  }

  get score() {
    return this._score;
  }

  get elapsed() {
    return this._elapsed;
  }

  /** 目前關卡形狀閥的選項數（供 UI 使用）。 */
  get currentLevelShapeCount() {
    if (this.levels.length === 0) return 0;
    return this.levels[this._levelIdx].shapeCount;
  }

  /** 目前關卡物件閥的選項數（供 UI 使用）。 */
  get currentLevelObjectCount() {
    if (this.levels.length === 0) return 0;
    return this.levels[this._levelIdx].objectCount;
  }

  /** 目前關卡序號（1..N，供 UI 使用）。 */
  get currentLevelNo() {
    if (this.levels.length === 0) return 0;
    return this.levels[this._levelIdx].levelNo;
  }

  setViewport(viewport) {
    this.viewport = viewport;
  }

  _resetPressTracking() {
    this._shapePressCount = 0;
    this._shapeFirstPressAgeMs = null;
    this._shapeLastPressAgeMs = null;
    this._objectPressCount = 0;
    this._objectFirstPressAgeMs = null;
    this._objectLastPressAgeMs = null;
  }

  _spawnTrial() {
    const level = this.levels.length > 0 ? this.levels[this._levelIdx] : null;
    const trial = level ? this.trialGen.next(level, this._levelDeck) : null;

    this._resetPressTracking();
    this._trialAllCorrect = true;
    this._trialFinalized = false;

    if (!trial) {
      if (!this._warnedNoTrial) {
        console.warn(
          `Track: no feasible trial for level=${level ? level.levelNo : 'n/a'}; skipping this level's play.`
        );
        this._warnedNoTrial = true;
      }
      this._target = null;
      this._trialLevelNo = null;
      this._trialShapeCount = null;
      this._trialObjectCount = null;
      this._trialObjectRule = null;
      this._valveShape = null;
      this._valveObject = null;
      return;
    }

    this._trialCounter += 1;
    this._currentTrialIndex = this._trialCounter;

    // 目標移動期間可能達到換關時間，因此在此固定判定屬性。
    this._trialLevelNo = trial.levelNo;
    this._trialShapeCount = trial.shapeCount;
    this._trialObjectCount = trial.objectCount;
    this._trialObjectRule = trial.objectRule;
    this._target = createTarget(trial.target, CONFIG.Z_SPAWN);

    this._valveShape = trial.shapeItems
      ? new Valve({
          items: trial.shapeItems,
          direction: -1,
          z: CONFIG.Z_VALVE_SHAPE,
          kind: 'shape',
        })
      : null;

    this._valveObject = trial.objectItems
      ? new Valve({
          items: trial.objectItems,
          direction: 1,
          z: CONFIG.Z_VALVE_OBJECT,
          kind: 'object',
        })
      : null;
  }

  _judge(valve, target) {
    const rule = ruleForValve(valve, this._trialObjectRule);
    const answer = valve.answer();
    const correct = isCorrect(rule, { frame: target.frame, content: target.content }, answer);
    const targetId = valve.kind === 'shape' ? target.frame.id : target.content.id;

    const isShape = valve.kind === 'shape';
    const firstPressAgeMs = isShape ? this._shapeFirstPressAgeMs : this._objectFirstPressAgeMs;
    const lastPressAgeMs = isShape ? this._shapeLastPressAgeMs : this._objectLastPressAgeMs;
    const pressCount = isShape ? this._shapePressCount : this._objectPressCount;

    const settleMs = lastPressAgeMs === null ? null : Math.round(target.ageMs - lastPressAgeMs);
    const firstInputMs = firstPressAgeMs === null ? null : Math.round(firstPressAgeMs);
    const slotsRotated = pressCount;

    const optionCount = isShape ? this._trialShapeCount : this._trialObjectCount;

    this.stats.record({
      trialIndex: this._currentTrialIndex,
      level: this._trialLevelNo,
      optionCount,
      valveKind: valve.kind,
      rule,
      targetId,
      answerId: answer.id,
      correct,
      settleMs,
      firstInputMs,
      slotsRotated,
    });

    if (!correct) this._trialAllCorrect = false;
  }

  /** 每題的兩道閥皆判定完成後，結算一次。全對才得分並顯示 ✓。 */
  _finishTrialIfJudged(target) {
    if (this._trialFinalized) return;
    if (this._valveShape && !target.passedShape) return;
    if (this._valveObject && !target.passedObject) return;
    this._trialFinalized = true;
    const correct = this._trialAllCorrect;
    this.stats.recordTrial({
      trialIndex: this._currentTrialIndex,
      level: this._trialLevelNo,
      correct,
    });
    if (correct) {
      this._score += 1;
      this._showTick = true;
      this._tickTimer = CONFIG.TICK_FEEDBACK_SECONDS;
    }
  }

  _advanceLevelIfDue(dt) {
    if (this.levels.length === 0) return;
    this._levelElapsed += dt;
    if (this._levelElapsed >= this._levelSeconds && this._levelIdx < this.levels.length - 1) {
      this._levelAdvancePending = true;
    }
  }

  _activateNextLevel() {
    if (!this._levelAdvancePending || this._levelIdx >= this.levels.length - 1) return false;

    this._levelIdx += 1;
    // 保留等待目前題目離場時累積的超時時間。
    this._levelElapsed = Math.max(0, this._levelElapsed - this._levelSeconds);
    this._levelAdvancePending = false;
    this._warnedNoTrial = false;
    this._retryTimer = 0;

    // 先產生新關卡的第一題。dccs.js 隨後暫停遊戲並顯示提示。
    this._levelDeck = buildLevelDeck(this.manifest, this.levels[this._levelIdx]);
    this._spawnTrial();
    return true;
  }

  update(dt) {
    this._elapsed += dt;
    this._advanceLevelIfDue(dt);

    if (this._tickTimer > 0) {
      this._tickTimer -= dt;
      if (this._tickTimer <= 0) {
        this._tickTimer = 0;
        this._showTick = false;
      }
    }

    // 沒有目標時仍處理輸入，避免將按鍵套用到下一題。
    const shapePresses = this.input.takePresses('rotateShape');
    const objectPresses = this.input.takePresses('rotateObject');

    if (!this._target) {
      // 目前沒有可完成的題目時，直接切換至已達開始時間的下一關。
      if (this._activateNextLevel()) return;

      // 無可用題型時，限制重試頻率，避免每幀重試。
      this._retryTimer -= dt;
      if (this._retryTimer <= 0) {
        this._retryTimer = RETRY_INTERVAL_SECONDS;
        this._spawnTrial();
      }
      return;
    }

    const target = this._target;

    // 先完成既有轉動動畫並判定答案。本幀的新按鍵在下一幀才開始轉動，
    // 避免目標通過時，新的按鍵移動仍在中央的正確答案。
    if (this._valveShape) this._valveShape.update(dt);
    if (this._valveObject) this._valveObject.update(dt);

    stepTarget(target, dt, CONFIG.TARGET_SPEED);

    // 以移動後的 target.ageMs 記錄本幀輸入，與判定共用時間基準。
    if (this._valveShape && shapePresses > 0) {
      this._shapePressCount += shapePresses;
      if (this._shapeFirstPressAgeMs === null) this._shapeFirstPressAgeMs = target.ageMs;
      this._shapeLastPressAgeMs = target.ageMs;
    }
    if (this._valveObject && objectPresses > 0) {
      this._objectPressCount += objectPresses;
      if (this._objectFirstPressAgeMs === null) this._objectFirstPressAgeMs = target.ageMs;
      this._objectLastPressAgeMs = target.ageMs;
    }

    if (this._valveShape && !target.passedShape && hasReachedZ(target, CONFIG.Z_VALVE_SHAPE)) {
      target.passedShape = true;
      this._judge(this._valveShape, target);
    }

    if (this._valveObject && !target.passedObject && hasReachedZ(target, CONFIG.Z_VALVE_OBJECT)) {
      target.passedObject = true;
      this._judge(this._valveObject, target);
    }

    this._finishTrialIfJudged(target);

    if (this._valveShape && shapePresses > 0) this._valveShape.step(shapePresses);
    if (this._valveObject && objectPresses > 0) this._valveObject.step(objectPresses);

    if (hasReachedZ(target, 0)) {
      if (!this._activateNextLevel()) this._spawnTrial();
    }
  }

  _drawTarget() {
    const target = this._target;
    if (!target) return;

    const frameImg = target.frame ? this.images.get(target.frame.id) : null;
    const contentImg = target.content ? this.images.get(target.content.id) : null;

    const size = targetSizeAt(target.z, this.viewport);

    if (frameImg && contentImg) {
      drawSprite(this._ctx, frameImg, target.z, 0, this.viewport, { size, inner: contentImg });
    } else if (frameImg) {
      drawSprite(this._ctx, frameImg, target.z, 0, this.viewport, { size });
    } else if (contentImg) {
      drawSprite(this._ctx, contentImg, target.z, 0, this.viewport, { size });
    }
  }

  _drawValve(valve) {
    if (!valve) return;
    for (const { item, lane } of valve.slots()) {
      const img = this.images.get(item.id);
      if (img) {
        drawSprite(this._ctx, img, valve.z, lane, this.viewport);
      }
    }
  }

  render(ctx, alpha) {
    this._ctx = ctx;
    const bg = this.images.get(this.backgroundKey);
    if (bg) {
      drawBackground(ctx, bg, this.viewport);
    }

    this._drawValve(this._valveShape);
    this._drawValve(this._valveObject);
    this._drawTarget();

    drawHud(ctx, this.viewport, {
      score: this._score,
      elapsed: this._elapsed,
      total: this.sessionSeconds,
      level: this.currentLevelNo,
      remaining: Math.max(0, this._levelSeconds - this._levelElapsed),
      showTick: this._showTick,
    });
  }
}
