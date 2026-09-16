import { mountDCCS, buildTutorialContent } from './dccs.js';
import { loadManifest } from './core/assets.js';
import { ensureOverlayStyles, renderTutorialInto } from './ui/overlays.js';
import { submitResult } from './net/client.js';
import { readLobbySession, resolveCurrentDay, returnToLobby } from './lobby.js';
import { readSessionSecondsOverride, markDebugSession } from './debugParams.js';

const form =
  document.getElementById('setup-form');

const doubleGame =
  document.getElementById('double-game');

const finalResult =
  document.getElementById('final-result');

const sharedOverlay =
  document.getElementById('shared-overlay');

const sharedLoading =
  document.getElementById('shared-loading');

const sharedTitle =
  document.getElementById('shared-title');

const sharedTutorial =
  document.getElementById('shared-tutorial');

const sharedTutorialBody =
  document.getElementById('shared-tutorial-body');

const sharedLevel =
  document.getElementById('shared-level');

const sharedError =
  document.getElementById('shared-error');

const sharedPlayerInfo =
  document.getElementById('shared-player-info');

const sharedLevelBadge =
  document.getElementById('shared-level-badge');

const sharedLevelMessage =
  document.getElementById('shared-level-message');

const sharedContinue =
  document.getElementById('shared-continue');

const sharedErrorMessage =
  document.getElementById('shared-error-message');

function createPairId() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto.randomUUID();
  }

  return (
    `dccs-${Date.now()}-` +
    Math.random().toString(16).slice(2)
  ).slice(0, 36);
}

function showSharedScreen(target) {
  const screens = [
    sharedLoading,
    sharedTutorial,
    sharedTitle,
    sharedLevel,
    sharedError,
  ];

  for (const screen of screens) {
    screen.hidden =
      screen !== target;
  }

  sharedOverlay.classList.toggle(
    'level-mode',
    target === sharedLevel
  );

  sharedOverlay.classList.toggle(
    'dccs-overlay-level',
    target === sharedLevel
  );

  sharedOverlay.classList.toggle(
    'tutorial-mode',
    target === sharedTutorial
  );

  sharedOverlay.classList.toggle(
    'dccs-overlay-tutorial',
    target === sharedTutorial
  );

  sharedOverlay.hidden = false;
}

function hideSharedOverlay() {
  sharedOverlay.hidden = true;

  sharedOverlay.classList.remove(
    'level-mode',
    'dccs-overlay-level',
    'tutorial-mode',
    'dccs-overlay-tutorial'
  );
}

function makeDoublePayload(result, pairId) {
  const payload =
    JSON.parse(
      JSON.stringify(result.payload)
    );

  payload.data.mode = 'double';
  payload.data.pairId = pairId;

  return payload;
}

async function submitPlayerResult(payload) {
  const { ok, detail } =
    await submitResult(payload);

  if (!ok) {
    // submitResult 已負責暫存；拋錯讓結算畫面標示送出失敗。
    throw new Error(detail);
  }

  if (!detail) {
    return {};
  }

  try {
    return JSON.parse(detail);
  } catch (_err) {
    return {};
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function submissionMessage(
  result,
  playerName
) {
  if (result.status === 'fulfilled') {
    return `
      <p class="save-success">
        ${playerName}：成績已成功送出。
      </p>
    `;
  }

  const reason =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason);

  // 伺服器有時會回傳完整 HTML 錯誤頁；結算卡只顯示第一行摘要，避免把外部
  // HTML 插進頁面、撐壞左右卡片，也避免不可信內容被當成標記解析。
  const reasonSummary =
    escapeHtml(
      (reason.split(/\r?\n/, 1)[0] || '未知錯誤')
        .slice(0, 180)
    );

  return `
    <p class="save-error">
      ${playerName}：成績送出失敗
      （${reasonSummary}）——已暫存於本機，下次開啟遊戲會自動重送。
    </p>
  `;
}

let cameFromLobby = false;

// 只顯示一份共用教學；兩個 mountDCCS 實例都停用自己的教學層。
async function showSharedTutorial() {
  ensureOverlayStyles();

  try {
    const manifestUrl =
      new URL('../manifest.json', import.meta.url).href;

    const assetBase =
      new URL('../', import.meta.url).href;

    const manifest =
      await loadManifest(manifestUrl);

    renderTutorialInto(
      sharedTutorialBody,
      buildTutorialContent(manifest, assetBase)
    );
  } catch (error) {
    console.warn('操作說明載入失敗，略過：', error);
    return;
  }

  showSharedScreen(sharedTutorial);

  await new Promise((resolve) => {
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;

      window.removeEventListener('keydown', onKeyDown);
      resolve();
    }

    function onKeyDown(event) {
      if (
        event.code !== 'Enter' &&
        event.code !== 'NumpadEnter' &&
        event.code !== 'Space'
      ) {
        return;
      }

      event.preventDefault();
      finish();
    }

    window.addEventListener('keydown', onKeyDown);
  });

  showSharedScreen(sharedLoading);
}

async function startSession(player1, player2) {
    const sessionSecondsOverride =
      readSessionSecondsOverride();

    if (sessionSecondsOverride !== null) {
      markDebugSession(sessionSecondsOverride);
    }

    const sessionSecondsOption =
      sessionSecondsOverride !== null
        ? { sessionSeconds: sessionSecondsOverride }
        : {};

    const pairId =
      createPairId();

    form.hidden = true;
    finalResult.hidden = true;
    doubleGame.hidden = false;

    showSharedScreen(sharedLoading);

    await showSharedTutorial();

    sharedPlayerInfo.textContent =
      `玩家 1：${player1.caseId}　｜　` +
      `玩家 2：${player2.caseId}`;

    const playerPhases = {
      1: 'loading',
      2: 'loading',
    };

    // 教學已取得開始意圖，兩側載入後直接進入第 1 關提示。
    let bothPlayersReady = true;
    let continueLocked = false;

    let spaceDown = false;
    let canContinueWithSpace = false;

    function getInternalContinueButtons() {
      return Array.from(
        doubleGame.querySelectorAll(
          '.dccs-level-continue'
        )
      );
    }

    function getCurrentLevelNumber() {
      const badges =
        Array.from(
          doubleGame.querySelectorAll(
            '.dccs-level-badge'
          )
        );

      for (const badge of badges) {
        const match =
          badge.textContent.match(/\d+/);

        if (match) {
          return Number(match[0]);
        }
      }

      return 1;
    }

    function showCurrentLevel() {
      const levelNumber =
        getCurrentLevelNumber();

      sharedLevelBadge.textContent =
        `第 ${levelNumber} 關`;

      sharedLevelMessage.textContent =
        `準備開始第 ${levelNumber} 關！`;

      // 進入提示時若空白鍵仍按著，必須放開再按，避免直接跳過。
      canContinueWithSpace =
        !spaceDown;

      showSharedScreen(
        sharedLevel
      );

      // 不 focus 按鈕，否則空白鍵放開可能觸發 click 而跳過提示。
      if (
        document.activeElement &&
        typeof document.activeElement.blur ===
          'function'
      ) {
        document.activeElement.blur();
      }
    }

    function continueBothPlayers() {
      if (continueLocked) {
        return;
      }

      const buttons =
        getInternalContinueButtons();

      if (buttons.length < 2) {
        return;
      }

      continueLocked = true;
      canContinueWithSpace = false;

      for (const button of buttons) {
        button.click();
      }

      window.setTimeout(
        () => {
          continueLocked = false;
        },
        0
      );
    }

    function handlePlayerPhase(
      playerNumber,
      phase
    ) {
      playerPhases[playerNumber] =
        phase;

      if (
        playerPhases[1] === 'title' &&
        playerPhases[2] === 'title'
      ) {
        bothPlayersReady = true;
        canContinueWithSpace = false;

        showSharedScreen(
          sharedTitle
        );

        return;
      }

      if (
        playerPhases[1] === 'level-prompt' &&
        playerPhases[2] === 'level-prompt'
      ) {
        window.setTimeout(
          showCurrentLevel,
          0
        );

        return;
      }

      if (
        playerPhases[1] === 'playing' &&
        playerPhases[2] === 'playing'
      ) {
        hideSharedOverlay();
        return;
      }

      if (phase === 'error') {
        sharedErrorMessage.textContent =
          '其中一位玩家載入失敗，請重新整理後再試一次。';

        showSharedScreen(
          sharedError
        );
      }
    }

    function blockEarlySpace(event) {
      if (
        event.code !== 'Space' ||
        bothPlayersReady
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    }

    window.addEventListener(
      'keydown',
      blockEarlySpace,
      true
    );

    function handleSharedSpaceDown(event) {
      if (event.code !== 'Space') {
        return;
      }

      if (event.repeat) {
        event.preventDefault();
        return;
      }

      spaceDown = true;

      if (!bothPlayersReady) {
        return;
      }

      event.preventDefault();

      // 標題畫面由兩個遊戲實例自行接收同一個空白鍵。
      if (!sharedTitle.hidden) {
        return;
      }

      if (
        !sharedLevel.hidden &&
        canContinueWithSpace
      ) {
        continueBothPlayers();
      }
    }

    window.addEventListener(
      'keydown',
      handleSharedSpaceDown
    );

    function handleSharedSpaceUp(event) {
      if (event.code !== 'Space') {
        return;
      }

      spaceDown = false;

      if (!sharedLevel.hidden) {
        canContinueWithSpace = true;
      }
    }

    window.addEventListener(
      'keyup',
      handleSharedSpaceUp
    );

    function handleSharedContinue(event) {
      event.preventDefault();

      continueBothPlayers();
    }

    sharedContinue.addEventListener(
      'click',
      handleSharedContinue
    );

    function removeSharedEvents() {
      window.removeEventListener(
        'keydown',
        blockEarlySpace,
        true
      );

      window.removeEventListener(
        'keydown',
        handleSharedSpaceDown
      );

      window.removeEventListener(
        'keyup',
        handleSharedSpaceUp
      );

      sharedContinue.removeEventListener(
        'click',
        handleSharedContinue
      );
    }

    const sharedSeed =
      Date.now();

    const player1Handle =
      mountDCCS({
        container:
          document.getElementById(
            'player1-game'
          ),

        student: player1,
        seed: sharedSeed,

        onPhase(phase) {
          handlePlayerPhase(
            1,
            phase
          );
        },

        backgroundKey: null,
        transparentBackground: true,
        viewportAspect: null,

        bindings: {
          rotateShape: ['KeyA'],
          rotateObject: ['KeyD'],
        },

        submit: false,
        showResultScreen: false,
        showTutorial: false,
        autoStart: true,
        ...sessionSecondsOption,
      });

    const player2Handle =
      mountDCCS({
        container:
          document.getElementById(
            'player2-game'
          ),

        student: player2,
        seed: sharedSeed,

        onPhase(phase) {
          handlePlayerPhase(
            2,
            phase
          );
        },

        backgroundKey: null,
        transparentBackground: true,
        viewportAspect: null,

        bindings: {
          rotateShape: ['ArrowLeft'],
          rotateObject: ['ArrowRight'],
        },

        submit: false,
        showResultScreen: false,
        showTutorial: false,
        autoStart: true,
        ...sessionSecondsOption,
      });

    try {
      const [
        result1,
        result2,
      ] = await Promise.all([
        player1Handle.done,
        player2Handle.done,
      ]);

      removeSharedEvents();

      const payload1 =
        makeDoublePayload(
          result1,
          pairId
        );

      const payload2 =
        makeDoublePayload(
          result2,
          pairId
        );

      console.log(
        '玩家 1 雙人成績：',
        payload1
      );

      console.log(
        '玩家 2 雙人成績：',
        payload2
      );

      const submissions =
        await Promise.allSettled([
          submitPlayerResult(payload1),
          submitPlayerResult(payload2),
        ]);

      const player1Accuracy =
        (
          result1.summary.accuracy *
          100
        ).toFixed(1);

      const player2Accuracy =
        (
          result2.summary.accuracy *
          100
        ).toFixed(1);

      doubleGame.hidden = true;
      hideSharedOverlay();
      finalResult.hidden = false;

      finalResult.innerHTML = `
        <h1 class="result-title">雙人遊戲完成</h1>

        <p class="result-pair-id">
          本局 pairId：
          ${pairId}
        </p>

        <div class="result-players">
          <section class="result-player-card">
            <h2>玩家 1</h2>

            <p>
              個案編號：
              <strong>${escapeHtml(player1.caseId)}</strong>
            </p>

            <p>
              答對：
              <strong>${result1.summary.correct_count}</strong>
            </p>

            <p>
              答錯：
              <strong>${result1.summary.wrong_count}</strong>
            </p>

            <p>
              正確率：
              <strong>${player1Accuracy}%</strong>
            </p>

            ${submissionMessage(
              submissions[0],
              '玩家 1'
            )}
          </section>

          <section class="result-player-card">
            <h2>玩家 2</h2>

            <p>
              個案編號：
              <strong>${escapeHtml(player2.caseId)}</strong>
            </p>

            <p>
              答對：
              <strong>${result2.summary.correct_count}</strong>
            </p>

            <p>
              答錯：
              <strong>${result2.summary.wrong_count}</strong>
            </p>

            <p>
              正確率：
              <strong>${player2Accuracy}%</strong>
            </p>

            ${submissionMessage(
              submissions[1],
              '玩家 2'
            )}
          </section>
        </div>

        <div class="result-actions">
          <button
            type="button"
            id="play-again"
          >
            再玩一次
          </button>

          ${
            cameFromLobby
              ? '<button type="button" id="back-to-lobby">回遊戲大廳</button>'
              : ''
          }
        </div>
      `;

      document
        .getElementById('play-again')
        .addEventListener(
          'click',

          () => {
            window.location.reload();
          }
        );

      // 雙人版手動返回，讓兩位受試者先看完成績與送出狀態。
      if (cameFromLobby) {
        document
          .getElementById('back-to-lobby')
          .addEventListener(
            'click',
            returnToLobby
          );
      }
    } catch (error) {
      removeSharedEvents();

      console.error(error);

      doubleGame.hidden = true;
      hideSharedOverlay();
      finalResult.hidden = false;

      finalResult.textContent =
        `遊戲發生錯誤：${error.message}`;
    }
}

form.addEventListener(
  'submit',

  async (event) => {
    event.preventDefault();

    const formData =
      new FormData(form);

    const school =
      formData
        .get('school')
        .trim();

    const currentDay =
      formData
        .get('currentDay')
        .trim();

    const player1 = {
      grade: formData.get('grade1').trim(),
      caseId: formData.get('caseId1').trim(),
      school,
      currentDay,
    };

    const player2 = {
      grade: formData.get('grade2').trim(),
      caseId: formData.get('caseId2').trim(),
      school,
      currentDay,
    };

    if (
      player1.caseId ===
      player2.caseId
    ) {
      window.alert(
        '玩家 1 和玩家 2 的個案編號不能相同。'
      );

      return;
    }

    await startSession(player1, player2);
  }
);

// 雙人 currentDay 必須一致；無法可靠推導時退回手動表單。
async function bootFromLobby() {
  const session = readLobbySession();
  if (!session || session.mode !== 'double') return false;

  const [lobby1, lobby2] = session.players;

  let currentDay;
  try {
    const [day1, day2] = await Promise.all([
      resolveCurrentDay(lobby1),
      resolveCurrentDay(lobby2),
    ]);

    if (day1 !== day2) {
      throw new Error(
        `兩位玩家推導出的第幾天不一致（${day1} / ${day2}）`
      );
    }

    currentDay = day1;
  } catch (err) {
    console.warn('無法自動判斷 currentDay，改由人工填寫：', err);
    return false;
  }

  cameFromLobby = true;

  await startSession(
    { grade: lobby1.grade, caseId: lobby1.caseId, school: lobby1.school, currentDay },
    { grade: lobby2.grade, caseId: lobby2.caseId, school: lobby2.school, currentDay }
  );

  return true;
}

bootFromLobby().then((started) => {
  if (!started) form.hidden = false;
});
