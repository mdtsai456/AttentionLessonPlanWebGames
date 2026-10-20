// 遊戲引擎的 Node 單元測試，不需要瀏覽器。
// 單人與雙人資料夾各有一份引擎與關卡設定，兩份都要驗。
//
// 執行：cd DCCS_single/tests && npm run test:unit

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const GAME_DIRS = ['DCCS_single', 'DCCS_double'];
const repoUrl = new URL('../../', import.meta.url);

async function readJson(dir, name) {
  return JSON.parse(await readFile(new URL(`${dir}/${name}`, repoUrl), 'utf8'));
}

async function loadEngine(dir) {
  const base = new URL(`${dir}/js/`, repoUrl).href;
  const [{ Track }, trialGen, { createStats }, { CONFIG }] = await Promise.all([
    import(`${base}game/track.js`),
    import(`${base}game/trialGen.js`),
    import(`${base}game/stats.js`),
    import(`${base}config.js`),
  ]);
  return { Track, trialGen, createStats, CONFIG };
}

// 固定種子的亂數，讓每次跑出同一場。
function seededRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// 假鍵盤：排定的按鍵在下一次 update 被取走。
function fakeInput() {
  const queued = { rotateShape: 0, rotateObject: 0 };
  return {
    queue(action, count = 1) {
      queued[action] += count;
    },
    takePresses(action) {
      const count = queued[action];
      queued[action] = 0;
      return count;
    },
  };
}

function makeTrack(engine, manifest, input, sessionSeconds, extra = {}) {
  const stats = engine.createStats();
  const track = new engine.Track({
    manifest,
    images: new Map(),
    input,
    viewport: { x: 0, y: 0, w: 1280, h: 720 },
    rng: seededRng(12345),
    stats,
    sessionSeconds,
    ...extra,
  });
  return { track, stats };
}

for (const dir of GAME_DIRS) {
  test(`${dir}：manifest.json 的關卡與 levels.json 一致，且六關都可出題`, async () => {
    const [levelsConfig, manifest] = await Promise.all([
      readJson(dir, 'levels.json'),
      readJson(dir, 'manifest.json'),
    ]);
    const { trialGen } = await loadEngine(dir);

    assert.equal(manifest.levels.length, 6);
    assert.equal(levelsConfig.levels.length, manifest.levels.length);
    levelsConfig.levels.forEach((level, index) => {
      const generated = manifest.levels[index];
      for (const [key, value] of Object.entries(level)) {
        assert.deepEqual(generated[key], value, `第 ${index + 1} 關 ${key} 與 levels.json 不符`);
      }
      assert.equal(generated.playable, true, `第 ${index + 1} 關 manifest 標成不可玩`);
    });
    assert.deepEqual(manifest.warnings, []);

    for (const level of manifest.levels) {
      const feasibility = trialGen.levelFeasibility(manifest, level);
      assert.equal(feasibility.ok, true, `第 ${level.levelNo} 關不可行：${feasibility.reason}`);
      const deck = trialGen.buildLevelDeck(manifest, level);
      const trial = trialGen.createTrialGenerator(manifest, seededRng(1)).next(level, deck);
      assert.ok(trial, `第 ${level.levelNo} 關產生不出題目`);
      assert.equal(trial.objectItems.length, level.objectCount);
    }
  });

  test(`${dir}：整場跑完會到第 6 關，最後一關有題目且有記錄`, async () => {
    const manifest = await readJson(dir, 'manifest.json');
    const engine = await loadEngine(dir);
    const sessionSeconds = engine.CONFIG.SESSION_SECONDS;
    const { track, stats } = makeTrack(engine, manifest, fakeInput(), sessionSeconds);

    const dt = engine.CONFIG.FIXED_DT;
    while (track.elapsed < sessionSeconds) track.update(dt);

    const summary = stats.summary();
    assert.equal(summary.stage, 6);
    assert.equal(summary.levelsPlayed, '1,2,3,4,5,6');
    const level6Trials = stats.trials().filter((trial) => trial.level === 6);
    // 每關 60 秒、每題約 5.4 秒，第 6 關至少要有好幾題。
    assert.ok(level6Trials.length >= 5, `第 6 關只有 ${level6Trials.length} 題`);
  });

  test(`${dir}：判定當幀的按鍵不影響答案，也不得計入該題的 slotsRotated 與時間欄位`, async () => {
    const manifest = await readJson(dir, 'manifest.json');
    const engine = await loadEngine(dir);
    const input = fakeInput();
    const { track, stats } = makeTrack(engine, manifest, input, engine.CONFIG.SESSION_SECONDS);
    const dt = engine.CONFIG.FIXED_DT;
    const speed = engine.CONFIG.TARGET_SPEED;

    for (const [valveKey, action, zKey, passedKey] of [
      ['_valveShape', 'rotateShape', 'Z_VALVE_SHAPE', 'passedShape'],
      ['_valveObject', 'rotateObject', 'Z_VALVE_OBJECT', 'passedObject'],
    ]) {
      // 推進到「下一次 update 就會通過這道閥」的那一幀。
      while (track._target.z - speed * dt > engine.CONFIG[zKey]) track.update(dt);
      assert.equal(track._target[passedKey], false);

      const valve = track[valveKey];
      const answerBefore = valve.answer();
      const trialIndex = track._currentTrialIndex;
      input.queue(action, 1);
      track.update(dt);

      assert.equal(track._target[passedKey], true, '這一幀應該完成判定');
      const row = stats.rows().find((item) =>
        item.trialIndex === trialIndex && item.valveKind === valve.kind);
      assert.ok(row, `${valve.kind} 閥沒有判定紀錄`);
      assert.equal(row.answerId, answerBefore.id, '判定當幀的按鍵改變了答案');
      assert.equal(row.slotsRotated, 0, '判定後才生效的按鍵被算進 slotsRotated');
      assert.equal(row.settleMs, null);
      assert.equal(row.firstInputMs, null);
      // 這一下照樣排入轉動，下一幀才開始轉（刻意行為）。
      assert.equal(valve.pendingSteps, 1);
    }
  });

  // 當天已完成前半：從第 4 關開始，只玩第 4～6 關。
  test(`${dir}：Track 從第 4 關開始（startLevelIdx），時間從第 3 關結束接著算，levelAccuracy 只有第 4～6 關`, async () => {
    const manifest = await readJson(dir, 'manifest.json');
    const engine = await loadEngine(dir);
    const sessionSeconds = engine.CONFIG.SESSION_SECONDS;
    const levelSeconds = sessionSeconds / manifest.levels.length;
    const { track, stats } = makeTrack(engine, manifest, fakeInput(), sessionSeconds, { startLevelIdx: 3 });

    assert.equal(track.currentLevelNo, 4);
    assert.equal(track.elapsed, 3 * levelSeconds);
    assert.equal(track.score, 0);
    assert.equal(track._trialLevelNo, 4, '第一題應該出第 4 關的題');
    assert.equal(track._currentTrialIndex, 0, '題號從 0 開始');

    const dt = engine.CONFIG.FIXED_DT;
    while (track.elapsed < sessionSeconds) track.update(dt);

    const summary = stats.summary();
    assert.equal(summary.levelsPlayed, '4,5,6');
    assert.equal(summary.stage, 6);
    assert.equal(summary.levelAccuracy.length, 3);
    for (const [index, level] of [4, 5, 6].entries()) {
      const levelTrials = stats.trials().filter((trial) => trial.level === level);
      assert.ok(levelTrials.length > 0, `第 ${level} 關沒有題目`);
      const expected = levelTrials.filter((trial) => trial.correct).length / levelTrials.length;
      assert.equal(summary.levelAccuracy[index], expected, `levelAccuracy 第 ${index + 1} 個值應該是第 ${level} 關`);
    }
    assert.equal(summary.questionCount, stats.trials().length);
  });

  test(`${dir}：Track 沒給 startLevelIdx 時照舊從第 1 關、時間 0 開始；超出範圍時夾到最後一關`, async () => {
    const manifest = await readJson(dir, 'manifest.json');
    const engine = await loadEngine(dir);
    const sessionSeconds = engine.CONFIG.SESSION_SECONDS;
    const { track } = makeTrack(engine, manifest, fakeInput(), sessionSeconds);
    assert.equal(track.currentLevelNo, 1);
    assert.equal(track.elapsed, 0);
    assert.equal(track.score, 0);
    assert.equal(track._currentTrialIndex, 0);

    const { track: clamped } = makeTrack(engine, manifest, fakeInput(), sessionSeconds, { startLevelIdx: 99 });
    assert.equal(clamped.currentLevelNo, manifest.levels.length);
    const { track: negative } = makeTrack(engine, manifest, fakeInput(), sessionSeconds, { startLevelIdx: -2 });
    assert.equal(negative.currentLevelNo, 1);
    assert.equal(negative.elapsed, 0);
  });

  test(`${dir}：stats 的 levelAccuracy 從第一個有玩的關卡連續取到最後一關`, async () => {
    const engine = await loadEngine(dir);
    const stats = engine.createStats();
    const answers = { 4: [true, false], 5: [true, true, true, false], 6: [false] };
    let trialIndex = 0;
    for (const [level, results] of Object.entries(answers)) {
      for (const correct of results) {
        stats.recordTrial({ trialIndex: trialIndex++, level: Number(level), correct });
      }
    }
    assert.deepEqual(stats.summary().levelAccuracy, [0.5, 0.75, 0]);

    // 中間缺一關就停在缺的那一關之前（和從第 1 關開始時一樣）。
    const gap = engine.createStats();
    gap.recordTrial({ trialIndex: 0, level: 4, correct: true });
    gap.recordTrial({ trialIndex: 1, level: 6, correct: true });
    assert.deepEqual(gap.summary().levelAccuracy, [1]);

    assert.deepEqual(engine.createStats().summary().levelAccuracy, []);
  });
}
