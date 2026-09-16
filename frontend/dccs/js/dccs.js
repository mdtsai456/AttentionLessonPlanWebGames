// 可嵌入的 DCCS 公開 API。每次 mountDCCS() 都維護獨立狀態。

import { CONFIG } from './config.js';
import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { loadManifest, preloadImages } from './core/assets.js';
import { Track } from './game/track.js';
import { createStats } from './game/stats.js';
import { buildPayload, submitResult } from './net/client.js';
import { createOverlays } from './ui/overlays.js';

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

  // 單人模式預設使用 Single.png。
  // 雙人模式可傳入 null，不讓個別 Canvas 再畫背景。
  const backgroundKey =
    opts.backgroundKey === undefined
      ? 'single'
      : opts.backgroundKey;

  // 雙人模式使用透明 Canvas，顯示下面共同的 Double.png。
  const transparentBackground =
    !!opts.transparentBackground;

  // 單人模式維持 16:9。
  // 雙人模式傳入 null，讓畫面填滿左右半邊。
  const viewportAspect =
    opts.viewportAspect === undefined
      ? 16 / 9
      : opts.viewportAspect;

  const autoStart = !!opts.autoStart;

  const showResultScreen =
    opts.showResultScreen !== false;

  const submit =
    opts.submit !== false;

  const submitUrl =
    opts.submitUrl || '/api/results';

  const onPhase =
    typeof opts.onPhase === 'function'
      ? opts.onPhase
      : null;

  function emitPhase(phase) {
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

      if (!autoStart) {
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
            if (event.code !== 'Space') {
              return;
            }

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