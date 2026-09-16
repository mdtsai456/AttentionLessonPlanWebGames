// 可嵌入的 DCCS 公開 API。每次 mountDCCS() 都維護獨立狀態。

import { CONFIG } from './config.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { loadManifest, preloadImages } from './core/assets.js';
import { Track } from './game/track.js';
import { createStats } from './game/stats.js';
import { buildPayload, submitResult, flushPendingResults } from './net/client.js';
import { resolveSubmitUrl } from './net/apiBase.js';
import { createOverlays } from './ui/overlays.js';

// 雙人頁只允許一個實例重送暫存成績。
let pendingFlushStarted = false;

/**
 * 單頁操作說明；依 SPEC 1.4 不揭露答題規則。
 *
 * @param {object} manifest
 * @param {string} assetBase manifest 相對路徑的基準網址
 * @returns {object} 傳給 overlays.showTutorial 的內容
 */
export function buildTutorialContent(manifest, assetBase) {
  const toSrc = (item) =>
    new URL(item.src, assetBase).href;

  const shapes =
    Array.isArray(manifest.shapes)
      ? manifest.shapes.slice(0, 3).map((item) => ({
          src: toSrc(item),
          framed: true,
        }))
      : [];

  const firstCategory =
    Array.isArray(manifest.categories) && manifest.categories.length > 0
      ? manifest.categories[0]
      : null;

  const objects =
    firstCategory && Array.isArray(firstCategory.images)
      ? firstCategory.images.slice(0, 3).map((item) => ({
          src: toSrc(item),
        }))
      : [];

  return {
    title: '先學會怎麼操作',
    lead: '遊戲裡有上、下兩排選項，請用不同的按鍵轉動它們。',
    rows: [
      {
        label: '控制上排',
        keys: ['←', 'A'],
        note: '每按一下，上排會轉動一格。',
        images: shapes,
      },
      {
        label: '控制下排',
        keys: ['→', 'D'],
        note: '每按一下，下排會轉動一格。',
        images: objects,
      },
    ],
    answer: '物件通過兩排選項時，停在正中間的圖案，就是你的答案。',
    reassurance: '別緊張，答錯不扣分，遊戲也不會重來。',
  };
}

export const DCCS_DEFAULT_BINDINGS = {
  rotateShape: ['ArrowLeft', 'KeyA'],
  rotateObject: ['ArrowRight', 'KeyD'],
};

function createRng(seed) {
  let t = seed >>> 0;

  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function timeInfo(ms) {
  return {
    iso: new Date(ms).toISOString(),
    ms,
  };
}

function emptySummary() {
  return {
    frameCorrectCount: 0,
    frameWrongCount: 0,
    categoryCorrectCount: 0,
    categoryWrongCount: 0,
    modelCorrectCount: 0,
    modelWrongCount: 0,
    correct_count: 0,
    wrong_count: 0,
    accuracy: 0,
    duration: 0,
    stage: 0,
    levelsPlayed: '',
  };
}

export function mountDCCS(options) {
  const opts = options || {};

  const container = opts.container;

  if (!container) {
    throw new Error('mountDCCS: options.container is required');
  }

  const student = opts.student;

  if (
    !student ||
    !student.grade ||
    !student.caseId ||
    !student.school ||
    student.currentDay === undefined ||
    student.currentDay === null ||
    student.currentDay === ''
  ) {
    throw new Error(
      'mountDCCS: options.student requires grade, caseId, school, currentDay'
    );
  }

  const seed =
    opts.seed !== undefined && opts.seed !== null
      ? opts.seed
      : Date.now();

  const lessonId = opts.lessonId || 'lesson_DCCS';

  const sessionSeconds =
    opts.sessionSeconds ?? CONFIG.SESSION_SECONDS;

  if (!Number.isFinite(sessionSeconds) || sessionSeconds <= 0) {
    throw new Error(
      'mountDCCS: options.sessionSeconds must be a positive finite number'
    );
  }

  const bindings =
    opts.bindings || DCCS_DEFAULT_BINDINGS;

  const manifestUrl =
    opts.manifestUrl ||
    new URL('../manifest.json', import.meta.url).href;

  const assetBase =
    opts.assetBase ||
    new URL('../', import.meta.url).href;

  const backgroundKey =
    opts.backgroundKey === undefined
      ? 'single'
      : opts.backgroundKey;

  const transparentBackground =
    !!opts.transparentBackground;

  const viewportAspect =
    opts.viewportAspect === undefined
      ? 16 / 9
      : opts.viewportAspect;

  const autoStart = !!opts.autoStart;

  const showTutorial =
    opts.showTutorial !== false;

  const showResultScreen =
    opts.showResultScreen !== false;

  const submit =
    opts.submit !== false;

  const submitUrl =
    opts.submitUrl || resolveSubmitUrl();

  if (!pendingFlushStarted) {
    pendingFlushStarted = true;
    // 背景重送，不擋這一場開始；失敗就留到下次開場。
    flushPendingResults({ url: submitUrl }).catch(() => {});
  }

  const onPhase =
    typeof opts.onPhase === 'function'
      ? opts.onPhase
      : null;

  // 逐題資料只在記憶體中；進行中離頁會遺失，需觸發瀏覽器制式確認。
  const PHASES_IN_PROGRESS = new Set([
    'level-prompt',
    'playing',
    'submitting',
  ]);

  function guardUnload(shouldGuard) {
    if (shouldGuard === !!unloadHandler) {
      return;
    }

    if (shouldGuard) {
      unloadHandler = (event) => {
        event.preventDefault();
        // 舊版瀏覽器要 returnValue 有值才會顯示提示。
        event.returnValue = '';
      };

      window.addEventListener('beforeunload', unloadHandler);
      return;
    }

    window.removeEventListener('beforeunload', unloadHandler);
    unloadHandler = null;
  }

  function emitPhase(phase) {
    // 放在 onPhase 之前：沒有傳 onPhase 的呼叫端一樣要有離開保護。
    guardUnload(PHASES_IN_PROGRESS.has(phase));

    if (!onPhase) {
      return;
    }

    try {
      onPhase(phase);
    } catch (_error) {
      // 外部事件錯誤不影響遊戲。
    }
  }

  container.innerHTML = '';

  const previousPosition =
    getComputedStyle(container).position;

  if (previousPosition === 'static') {
    container.style.position = 'relative';
  }

  container.style.overflow = 'hidden';

  const canvas =
    document.createElement('canvas');

  canvas.className = 'dccs-canvas';

  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    background: transparentBackground
      ? 'transparent'
      : '#000',
  });

  const ctx =
    canvas.getContext('2d');

  if (!ctx) {
    throw new Error(
      'mountDCCS: 2D canvas context is unavailable'
    );
  }

  container.appendChild(canvas);

  let viewport = {
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  };

  let track = null;

  function resizeCanvas() {
    const rect =
      container.getBoundingClientRect();

    const dpr =
      window.devicePixelRatio || 1;

    const cssWidth =
      Math.max(1, rect.width);

    const cssHeight =
      Math.max(1, rect.height);

    canvas.width =
      Math.round(cssWidth * dpr);

    canvas.height =
      Math.round(cssHeight * dpr);

    let viewportWidth = canvas.width;
    let viewportHeight = canvas.height;
    let viewportX = 0;
    let viewportY = 0;

    if (
      Number.isFinite(viewportAspect) &&
      viewportAspect > 0
    ) {
      viewportHeight =
        canvas.width / viewportAspect;

      if (viewportHeight > canvas.height) {
        viewportHeight = canvas.height;
        viewportWidth =
          canvas.height * viewportAspect;
      }

      viewportX =
        (canvas.width - viewportWidth) / 2;

      viewportY =
        (canvas.height - viewportHeight) / 2;
    }

    viewport = {
      x: viewportX,
      y: viewportY,
      w: viewportWidth,
      h: viewportHeight,
    };

    if (track) {
      track.setViewport(viewport);
    }
  }

  resizeCanvas();

  const resizeObserver =
    new ResizeObserver(() => resizeCanvas());

  resizeObserver.observe(container);

  const overlays =
    createOverlays(container);

  let input = null;
  let loop = null;
  let statsInstance = null;
  let manifestRef = null;
  let sessionId = '';
  let startedAtMs = null;
  let destroyed = false;
  let titleKeyHandler = null;
  let unloadHandler = null;
  let resolveTitleWait = null;
  let settleDone;
  let rejectDone;

  const done =
    new Promise((resolve, reject) => {
      settleDone = resolve;
      rejectDone = reject;
    });

  function fail(errorValue) {
    const error =
      errorValue instanceof Error
        ? errorValue
        : new Error(String(errorValue));

    if (!destroyed) {
      overlays.showError(error.message);
      emitPhase('error');
      rejectDone(error);
    }
  }

  function cleanupRuntime() {
    if (loop) {
      loop.stop();
      loop = null;
    }

    if (input) {
      input.destroy();
      input = null;
    }

    resizeObserver.disconnect();
    guardUnload(false);

    if (titleKeyHandler) {
      window.removeEventListener(
        'keydown',
        titleKeyHandler
      );

      titleKeyHandler = null;
    }

    if (resolveTitleWait) {
      const resolve =
        resolveTitleWait;

      resolveTitleWait = null;
      resolve();
    }
  }

  function buildResultPayload(
    summary,
    endedAtMs
  ) {
    return buildPayload({
      lessonId,

      student: {
        grade: student.grade,
        caseId: student.caseId,
        school: student.school,
        currentDay: student.currentDay,

        startTime: timeInfo(
          startedAtMs || Date.now()
        ),

        endTime: timeInfo(
          endedAtMs || Date.now()
        ),
      },

      summary,
    });
  }

  function destroy() {
    if (destroyed) {
      return;
    }

    destroyed = true;

    cleanupRuntime();

    const elapsedSeconds =
      track ? track.elapsed : 0;

    if (statsInstance) {
      statsInstance.setDuration(
        Math.round(
          Math.min(
            elapsedSeconds,
            sessionSeconds
          ) * 1000
        )
      );
    }

    const summary =
      statsInstance
        ? statsInstance.summary()
        : emptySummary();

    const rows =
      statsInstance
        ? statsInstance.rows()
        : [];

    const warnings =
      manifestRef &&
      Array.isArray(manifestRef.warnings)
        ? manifestRef.warnings
        : [];

    const notes =
      manifestRef &&
      Array.isArray(manifestRef.notes)
        ? manifestRef.notes
        : [];

    let payload = null;

    try {
      payload =
        buildResultPayload(
          summary,
          Date.now()
        );
    } catch (_error) {
      // 中止時如果資料不完整，就不建立 payload。
    }

    overlays.destroy();
    container.innerHTML = '';

    emitPhase('done');

    settleDone({
      aborted: true,
      sessionId,
      seed,
      summary,
      rows,
      payload,
      warnings,
      notes,
      submitted: null,
    });
  }

  async function run() {
    try {
      emitPhase('loading');

      overlays.showLoading(
        '正在讀取關卡資料…'
      );

      const manifest =
        await loadManifest(manifestUrl);

      if (destroyed) {
        return;
      }

      manifestRef = manifest;

      overlays.showLoading(
        '正在載入圖片…'
      );

      const images =
        await preloadImages(
          manifest,
          assetBase
        );

      if (destroyed) {
        return;
      }

      const rng =
        createRng(seed);

      sessionId =
        `${Date.now().toString(36)}-` +
        `${Math.floor(rng() * 1e9).toString(36)}`;

      const tutorialStartsSession =
        showTutorial && !autoStart;

      if (tutorialStartsSession) {
        emitPhase('tutorial');

        await overlays.showTutorial(
          buildTutorialContent(manifest, assetBase)
        );

        if (destroyed) {
          return;
        }
      }

      if (!autoStart && !tutorialStartsSession) {
        emitPhase('title');

        overlays.showTitle({
          grade: student.grade,
          caseId: student.caseId,
          school: student.school,
          currentDay: student.currentDay,
          seed,
        });

        await new Promise((resolve) => {
          resolveTitleWait = resolve;

          titleKeyHandler = (event) => {
            if (
              event.code !== 'Space' &&
              event.code !== 'Enter' &&
              event.code !== 'NumpadEnter'
            ) {
              return;
            }

            // 空白鍵預設會捲動頁面；遊戲嵌在別人的頁面裡時會整頁跳一下。
            event.preventDefault();

            window.removeEventListener(
              'keydown',
              titleKeyHandler
            );

            titleKeyHandler = null;
            resolveTitleWait = null;
            resolve();
          };

          window.addEventListener(
            'keydown',
            titleKeyHandler
          );
        });

        if (destroyed) {
          return;
        }
      }

      let levelPromptActive = false;

      async function waitForLevelPrompt(
        levelNumber
      ) {
        levelPromptActive = true;

        emitPhase('level-prompt');

        await overlays.showLevelPrompt(
          levelNumber
        );

        if (destroyed) {
          return false;
        }

        if (input) {
          input.takePresses(
            'rotateShape'
          );

          input.takePresses(
            'rotateObject'
          );
        }

        overlays.hideAll();

        levelPromptActive = false;

        emitPhase('playing');

        return true;
      }

      const firstLevel =
        Array.isArray(manifest.levels)
          ? manifest.levels[0]
          : null;

      if (firstLevel) {
        const continued =
          await waitForLevelPrompt(
            firstLevel.levelNo || 1
          );

        if (!continued) {
          return;
        }
      } else {
        overlays.hideAll();
        emitPhase('playing');
      }

      statsInstance = createStats();

      input =
        createInput(bindings);

      resizeCanvas();

      track = new Track({
        manifest,
        images,
        input,
        viewport,
        rng,
        stats: statsInstance,
        backgroundKey,
        sessionSeconds,
      });

      startedAtMs = Date.now();

      let ended = false;

      async function finish() {
        if (loop) {
          loop.stop();
        }

        if (input) {
          input.destroy();
        }

        const endedAtMs = Date.now();

        statsInstance.setDuration(
          Math.round(
            Math.min(
              track.elapsed,
              sessionSeconds
            ) * 1000
          )
        );

        const summary =
          statsInstance.summary();

        const rows =
          statsInstance.rows();

        const warnings =
          Array.isArray(manifest.warnings)
            ? manifest.warnings
            : [];

        const notes =
          Array.isArray(manifest.notes)
            ? manifest.notes
            : [];

        const payload =
          buildResultPayload(
            summary,
            endedAtMs
          );

        let submitted = null;

        if (destroyed) {
          return;
        }

        if (submit) {
          emitPhase('submitting');

          if (showResultScreen) {
            overlays.showResult(
              summary,
              '正在送出成績…'
            );
          }

          submitted =
            await submitResult(
              payload,
              { url: submitUrl }
            );

          if (destroyed) {
            return;
          }

          if (showResultScreen) {
            const message =
              submitted.ok
                ? '成績已送出。'
                : `成績送出失敗，已存在本機（${submitted.detail}）。`;

            overlays.setResultStatus(
              message
            );
          }
        } else if (showResultScreen) {
          overlays.showResult(
            summary,
            ''
          );
        }

        if (destroyed) {
          return;
        }

        emitPhase('done');

        settleDone({
          aborted: false,
          sessionId,
          seed,
          summary,
          rows,
          payload,
          warnings,
          notes,
          submitted,
        });
      }

      loop = createLoop({
        update(deltaTime) {
          if (ended) {
            return;
          }

          if (levelPromptActive) {
            input.takePresses(
              'rotateShape'
            );

            input.takePresses(
              'rotateObject'
            );

            return;
          }

          const previousLevel =
            track.currentLevelNo;

          track.update(deltaTime);

          if (
            track.elapsed >= sessionSeconds
          ) {
            ended = true;

            void finish().catch(fail);

            return;
          }

          const currentLevel =
            track.currentLevelNo;

          if (
            currentLevel !== previousLevel
          ) {
            void waitForLevelPrompt(
              currentLevel
            );
          }
        },

        render(alpha) {
          if (transparentBackground) {
            ctx.clearRect(
              0,
              0,
              canvas.width,
              canvas.height
            );
          } else {
            ctx.fillStyle = '#000';

            ctx.fillRect(
              0,
              0,
              canvas.width,
              canvas.height
            );
          }

          track.render(ctx, alpha);
        },
      });

      loop.start();
    } catch (error) {
      fail(error);
    }
  }

  void run();

  return {
    done,
    destroy,

    get elapsed() {
      return track
        ? track.elapsed
        : 0;
    },
  };
}
