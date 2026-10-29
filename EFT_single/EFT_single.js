import { buildEftStats } from '../shared/eft-game-logic.js';
import { preloadEftAssets } from '../shared/eft-assets.js';
import { createEftPlayer } from '../shared/eft-player.js';

// 每關 60 秒，共 6 關。關卡時間內持續出題。單題 10 秒未作答時，計為錯誤並換題。
const STAGE_COUNT = 6;
const MID_STAGE = 3;

// DOM 與遊戲狀態
const $ = (id) => document.getElementById(id);
let gameStartTime = 0;
// 這一局的 submissionId：中場先送的第 3 關與打完的第 6 關共用，後端用較高關卡更新同一列。
let playId = '';
// 已送出（或正在送）的最高關卡與那次送出；同一關或更低的關卡不再另送。
let savedStage = 0;
// 同一個課次已完成前半時，這一局從第 4 關開始，只玩並只送後半（stage 6）。
let secondHalf = false;
let savePromise = Promise.resolve();

const player = createEftPlayer({
    root: document,
    getUi: (id) => $(id),
    keyBindings: { ArrowLeft: 'left', ArrowRight: 'right' },
    focusRestart: true,
    onGameStart: (startedAt) => {
        gameStartTime = startedAt;
        playId = window.WebGameApi.uuid();
    },
    onReset: () => {
        savedStage = 0;
        savePromise = Promise.resolve();
        $('mid-break-modal').hidden = true;
        $('btn-continue').disabled = false;
        $('btn-lobby').disabled = false;
    },
    onFinished: () => { void saveCurrentRun(STAGE_COUNT); },
    onStageEnd({ stage: finished, setPhase, resume, finish }) {
        if (finished === MID_STAGE) {
            setPhase('break');
            showMidBreak();
            // 到中場就先送第 3 關，之後直接關掉頁面也保得住前三關。
            void saveCurrentRun(MID_STAGE);
            return;
        }
        if (finished < STAGE_COUNT) {
            setPhase('stage_clear');
            window.showStageClear(finished).then(resume);
            return;
        }
        finish();
    },
});

// 隨機選取與素材輔助函式
function shuffle(items) { return player.shuffle(items); }
function asset(style, direction, opposite) { return player.asset(style, direction, opposite); }
function setEnabled(enabled) { player.setEnabled(enabled); }

// 關卡計時與進度介面
function stageRemaining() { return player.stageRemaining(); }
function updateProgress() { player.updateProgress(); }
function startStageClock() { player.startStageClock(); }
function stopStageClock() { player.stopStageClock(); }
function makeQuestion() { return player.makeQuestion(); }
function renderQuestion() { player.renderQuestion(); }

// 遊戲與關卡的生命週期
function beginStage(nextStage) { player.beginStage(nextStage); }
function startGame(options) {
    secondHalf = Boolean(options && options.startStage >= MID_STAGE + 1);
    player.startGame(options);
}
function resetGame() { player.resetGame(); }

function returnToLobby() {
    window.leaveTo('../Select/index.html');
}

function showMidBreak() {
    player.setPhase('break');
    setEnabled(false);
    $('mid-break-modal').hidden = false;
    $('btn-continue').focus();
}

function finishGame() {
    player.finishGame();
    $('mid-break-modal').hidden = true;
}

// 成績只算到該關結束為止（第 4、5 關中途離開送第 3 關時不含後面關卡）。
// 同一關或更低的關卡已送過（或正在送）就沿用那次；送失敗時清掉紀錄，下次離開會再送。
function saveCurrentRun(stage) {
    if (stage <= savedStage) return savePromise;
    savedStage = stage;
    const attempt = saveGameDataToBackend(player.checkpointStats(stage)).then((ok) => {
        if (!ok && savedStage === stage) savedStage = 0;
        return ok;
    });
    savePromise = attempt;
    return attempt;
}

function levelAccuracyText(stageCount) { return player.levelAccuracyText(stageCount); }

async function saveGameDataToBackend(data) {

    const grade = sessionStorage.getItem('grade') || sessionStorage.getItem('student1_grade');
    const caseId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case');
    const school = sessionStorage.getItem('school') || sessionStorage.getItem('student1_school');
    // 未取得登入學生資料時，不送出成績，避免將未登入的成績寫入正式資料庫。
    if (!grade || !caseId || !school) {
        console.warn('找不到登入學生資料，成績不送出');
        return true;
    }
    const currentDay = parseInt(
        sessionStorage.getItem('currentDay')
        || sessionStorage.getItem('student1_day')
        || sessionStorage.getItem('current_day')
        || '1',
        10
    );

    // 漂浮泡泡的成績使用 EFT 寫入。素材 API 也使用 EFT 查詢。
    const payload = {
        lessonId: '1140908_EFT',
        data: {
            grade,
            caseId,
            school,
            currentDay,
            startTime: window.WebGameRuntime.toWallTime(gameStartTime),
            // 該關結束當下的時間（中場或第 4、5 關才離開也不會多算）。
            endTime: data.endTime ?? Date.now(),
            mode: 'single',
            submissionId: playId,
            stats: buildEftStats(data),
        },
    };

    try {
        const res = await window.WebGameApi.submitSession(payload);
        if (res.status !== 201) {
            const errData = await res.json().catch(() => ({}));
            console.error(`成績送出失敗 ${res.status}:`, errData.detail || '寫入失敗');
            return false;
        }
        return true;
    } catch (err) {
        console.error('成績送出失敗：', err);
        return false;
    }
}
function recordOutcome(correct, reactionMs) { player.recordOutcome(correct, reactionMs); }
function continueAfterFeedback() { player.continueAfterFeedback(); }
function missQuestion(message) { player.missQuestion(message); }
function endStage() { player.endStage(); }
function answer(direction) { player.answer(direction); }

// 事件處理與啟動流程
function handleKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const overlay = !$('results').hidden ? $('results') : (!$('mid-break-modal').hidden ? $('mid-break-modal') : null);
    if (!overlay || event.key !== 'Tab') return;
    // 焦點留在彈窗內，Tab 往後、Shift+Tab 往前循環。
    event.preventDefault();
    const buttons = [...overlay.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement);
    const step = event.shiftKey ? -1 : 1;
    const next = current === -1
        ? (event.shiftKey ? buttons.length - 1 : 0)
        : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
}

// 先在頁面內確認，確定後才算檢查點、存檔並回大廳；取消什麼都不送，遊戲照常繼續。
async function leaveGame() {
    $('leave-btn').disabled = true;
    if (!(await window.confirmLeave())) {
        $('leave-btn').disabled = false;
        return;
    }
    const state = player.getState();
    const completed = state.phase === 'finished' || state.phase === 'break' || state.phase === 'stage_clear'
        ? state.stage
        : state.stage - 1;
    // 後半那一局沒有第 3 關可送：第 4、5 關離開什麼都不送，stage 3 那列留著，下次還是從第 4 關開始。
    const checkpoint = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE && !secondHalf ? MID_STAGE : 0;
    if (checkpoint) await saveCurrentRun(checkpoint);
    window.leaveTo('../Select/index.html');
    // 從上一頁（bfcache）回來時按鈕要能再按；已送過的檢查點不會重送。
    $('leave-btn').disabled = false;
}

function handleContinue() {
    $('mid-break-modal').hidden = true;
    beginStage(player.getState().stage + 1);
}

async function handleMidBreakLobby() {
    $('btn-continue').disabled = true;
    $('btn-lobby').disabled = true;
    await saveCurrentRun(MID_STAGE);
    returnToLobby();
}

function bindEvents() {
    document.addEventListener('keydown', handleKeydown);
    $('leave-btn').addEventListener('click', leaveGame);
    $('restart').addEventListener('click', () => startGame());
    $('btn-lobby-finish').addEventListener('click', returnToLobby);
    $('btn-continue').addEventListener('click', handleContinue);
    $('btn-lobby').addEventListener('click', handleMidBreakLobby);
}

function preloadGameAssets() {
    const studentId = sessionStorage.getItem('caseId')
        || sessionStorage.getItem('student1_case')
        || 'S001';
    // 查這個課次的成績和載入素材同時進行；查不到或超過 5 秒都從第 1 關開始。
    Promise.all([
        preloadEftAssets({ studentId }),
        (window.WebGameSecondHalf ? window.WebGameSecondHalf.startStage('EFT', { mode: 'single', slots: [1] }) : Promise.resolve(1)),
    ]).then(([arrowAssets, startStage]) => {
        player.setArrowAssets(arrowAssets);
        startGame({ startStage });
    }).catch(() => {
        $('feedback').textContent = '遊戲圖片載入失敗，請重新整理';
    });
}

const legacyApi = {
    shuffle, asset, setEnabled, stageRemaining, updateProgress, startStageClock,
    stopStageClock, makeQuestion, renderQuestion, beginStage, startGame,
    returnToLobby, showMidBreak, finishGame, saveCurrentRun, levelAccuracyText,
    saveGameDataToBackend, recordOutcome, continueAfterFeedback, missQuestion,
    endStage, answer, leaveGame
};

// 實作封裝於模組中，並保留傳統 script 可呼叫的函式名稱。
window.EFTSingle = Object.freeze({ ...legacyApi, resetGame });
Object.assign(window, legacyApi);

export {
    shuffle, asset, setEnabled, stageRemaining, updateProgress, startStageClock,
    stopStageClock, makeQuestion, renderQuestion, beginStage, startGame,
    returnToLobby, showMidBreak, finishGame, saveCurrentRun, levelAccuracyText,
    saveGameDataToBackend, recordOutcome, continueAfterFeedback, missQuestion,
    endStage, answer, leaveGame, resetGame
};

bindEvents();
// 還沒打完六關就關掉頁面時，先跳瀏覽器的離開詢問。
window.guardUnload(() => !['intro', 'finished'].includes(player.getState().phase));
preloadGameAssets();
