import { mountDCCS } from './dccs.js';
import { submitResult } from './net/client.js';

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

/*
  建立本局雙人共用的 pairId。
*/
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

/*
  顯示指定的共用畫面。
*/
function showSharedScreen(target) {
  const screens = [
    sharedLoading,
    sharedTitle,
    sharedLevel,
    sharedError,
  ];

  for (const screen of screens) {
    screen.hidden =
      screen !== target;
  }

  /*
    只有關卡提示使用黃色背景。
  */
  sharedOverlay.classList.toggle(
    'level-mode',
    target === sharedLevel
  );

  sharedOverlay.hidden = false;
}

/*
  隱藏共用畫面。
*/
function hideSharedOverlay() {
  sharedOverlay.hidden = true;

  sharedOverlay.classList.remove(
    'level-mode'
  );
}

/*
  將單人成績轉換為雙人格式。
*/
function makeDoublePayload(result, pairId) {
  const payload =
    JSON.parse(
      JSON.stringify(result.payload)
    );

  payload.data.mode = 'double';
  payload.data.pairId = pairId;

  return payload;
}

/*
  送出其中一位玩家的成績。

  端點由 net/apiBase.js 統一解析（本機開發指向本機後端，正式站指向 Zeabur），
  不再把正式站網址寫死在這裡——以前那樣寫，本機測雙人會把成績灌進正式庫。
*/
async function submitPlayerResult(payload) {
  const { ok, detail } =
    await submitResult(payload);

  if (!ok) {
    // submitResult 失敗時已把 payload 暫存在 localStorage，下次開場會自動
    // 重送；這裡照樣 throw，讓結算畫面照原本的方式標示這一位送出失敗。
    throw new Error(detail);
  }

  if (!detail) {
    return {};
  }

  try {
    return JSON.parse(detail);
  } catch (_err) {
    // 後端回的不是 JSON 也無妨，送出成功才是重點。
    return {};
  }
}

/*
  顯示成績送出結果。
*/
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

  return `
    <p class="save-error">
      ${playerName}：成績送出失敗
      （${reason}）——已暫存於本機，下次開啟遊戲會自動重送。
    </p>
  `;
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
      grade:
        formData
          .get('grade1')
          .trim(),

      caseId:
        formData
          .get('caseId1')
          .trim(),

      school,
      currentDay,
    };

    const player2 = {
      grade:
        formData
          .get('grade2')
          .trim(),

      caseId:
        formData
          .get('caseId2')
          .trim(),

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

    const pairId =
      createPairId();

    form.hidden = true;
    finalResult.hidden = true;
    doubleGame.hidden = false;

    showSharedScreen(sharedLoading);

    sharedPlayerInfo.textContent =
      `玩家 1：${player1.caseId}　｜　` +
      `玩家 2：${player2.caseId}`;

    /*
      儲存兩位玩家目前所在階段。
    */
    const playerPhases = {
      1: 'loading',
      2: 'loading',
    };

    let bothPlayersReady = false;
    let continueLocked = false;

    /*
      記錄空白鍵是否還按著。
    */
    let spaceDown = false;

    /*
      黃色畫面是否已經可以接受新的空白鍵。
    */
    let canContinueWithSpace = false;

    /*
      取得左右遊戲原本的繼續按鈕。
    */
    function getInternalContinueButtons() {
      return Array.from(
        doubleGame.querySelectorAll(
          '.dccs-level-continue'
        )
      );
    }

    /*
      讀取目前關卡編號。
    */
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

    /*
      顯示黃色關卡提示畫面。
    */
    function showCurrentLevel() {
      const levelNumber =
        getCurrentLevelNumber();

      sharedLevelBadge.textContent =
        `第 ${levelNumber} 關`;

      sharedLevelMessage.textContent =
        `準備開始第 ${levelNumber} 關！`;

      /*
        如果進入黃色畫面時，第一次空白鍵還沒放開，
        就不允許它直接開始遊戲。

        必須先放開，再重新按一次。
      */
      canContinueWithSpace =
        !spaceDown;

      showSharedScreen(
        sharedLevel
      );

      /*
        這裡不要使用 sharedContinue.focus()。

        否則第一次空白鍵放開時，
        瀏覽器可能會直接觸發按鈕 click，
        造成黃色畫面被跳過。
      */
      if (
        document.activeElement &&
        typeof document.activeElement.blur ===
          'function'
      ) {
        document.activeElement.blur();
      }
    }

    /*
      同時通過左右兩邊的關卡提示。
    */
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

    /*
      處理左右玩家的階段變化。
    */
    function handlePlayerPhase(
      playerNumber,
      phase
    ) {
      playerPhases[playerNumber] =
        phase;

      /*
        左右都載入到標題畫面後，
        才顯示共用的開始畫面。
      */
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

      /*
        左右都進入關卡提示後，
        顯示一個共用黃色畫面。
      */
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

      /*
        左右都正式開始後，
        隱藏黃色提示畫面。
      */
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

    /*
      左右都準備完成以前，
      不允許空白鍵啟動其中一邊。
    */
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

    /*
      空白鍵按下。
    */
    function handleSharedSpaceDown(event) {
      if (event.code !== 'Space') {
        return;
      }

      /*
        自動重複觸發不處理。
      */
      if (event.repeat) {
        event.preventDefault();
        return;
      }

      spaceDown = true;

      if (!bothPlayersReady) {
        return;
      }

      event.preventDefault();

      /*
        開始畫面：
        這裡不呼叫 continueBothPlayers()。

        空白鍵事件會繼續傳給左右兩個遊戲，
        讓它們一起進入黃色關卡畫面。
      */
      if (!sharedTitle.hidden) {
        return;
      }

      /*
        黃色關卡畫面：
        必須是放開前一次空白鍵後，
        再按下的新空白鍵，才開始遊戲。
      */
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

    /*
      空白鍵放開。

      第一次按空白鍵進入黃色畫面後，
      必須等到這個 keyup 發生，
      才允許下一次空白鍵開始遊戲。
    */
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

    /*
      點擊黃色畫面的綠色繼續按鈕，
      也可以讓左右兩邊一起開始。
    */
    function handleSharedContinue(event) {
      event.preventDefault();

      continueBothPlayers();
    }

    sharedContinue.addEventListener(
      'click',
      handleSharedContinue
    );

    /*
      移除事件監聽器。
    */
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

    /*
      左右兩邊使用相同的題目順序。
    */
    const sharedSeed =
      Date.now();

    /*
      建立玩家 1。
    */
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

        /*
          左右底圖由 CSS 各自顯示 Single.png。
        */
        backgroundKey: null,
        transparentBackground: true,
        viewportAspect: null,

        bindings: {
          rotateShape: ['KeyA'],
          rotateObject: ['KeyD'],
        },

        submit: false,
        showResultScreen: false,
      });

    /*
      建立玩家 2。
    */
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
        <h1>雙人遊戲完成</h1>

        <p>
          本局 pairId：
          ${pairId}
        </p>

        <section>
          <h2>玩家 1</h2>

          <p>
            個案編號：
            ${player1.caseId}
          </p>

          <p>
            答對：
            ${result1.summary.correct_count}
          </p>

          <p>
            答錯：
            ${result1.summary.wrong_count}
          </p>

          <p>
            正確率：
            ${player1Accuracy}%
          </p>

          ${submissionMessage(
            submissions[0],
            '玩家 1'
          )}
        </section>

        <section>
          <h2>玩家 2</h2>

          <p>
            個案編號：
            ${player2.caseId}
          </p>

          <p>
            答對：
            ${result2.summary.correct_count}
          </p>

          <p>
            答錯：
            ${result2.summary.wrong_count}
          </p>

          <p>
            正確率：
            ${player2Accuracy}%
          </p>

          ${submissionMessage(
            submissions[1],
            '玩家 2'
          )}
        </section>

        <button
          type="button"
          id="play-again"
        >
          再玩一次
        </button>
      `;

      document
        .getElementById('play-again')
        .addEventListener(
          'click',

          () => {
            window.location.reload();
          }
        );
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
);