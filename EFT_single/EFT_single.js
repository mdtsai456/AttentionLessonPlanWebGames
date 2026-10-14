import { buildEftStats } from '../shared/eft-game-logic.js';
import { preloadEftAssets } from '../shared/eft-assets.js';
import { createEftPlayer } from '../shared/eft-player.js';

// 每關 60 秒，共 6 關。關卡時間內持續出題。單題 10 秒未作答時，計為錯誤並換題。
const STAGE_COUNT = 6;
const MID_STAGE = 3;

// DOM 與遊戲狀態
const $ = (id) => document.getElementById(id);
let gameStartTime = 0;
let savedStage = 0;

const player = createEftPlayer({
    root: document,
    getUi: (id) => $(id),
    keyBindings: { ArrowLeft: 'left', ArrowRight: 'right' },
    focusRestart: true,
    onGameStart: (startedAt) => { gameStartTime = startedAt; },
    onReset: () => {
        savedStage = 0;
        $('mid-break-modal').hidden = true;
        $('btn-continue').disabled = false;
        $('btn-lobby').disabled = false;
    },
    onFinished: () => { void saveCurrentRun(STAGE_COUNT); },
    onStageEnd({ stage: finished, setPhase, resume, finish }) {
        if (finished === MID_STAGE) {
            setPhase('break');
            showMidBreak();
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
function startGame() { player.startGame(); }
function resetGame() { player.resetGame(); }

function returnToLobby() {
    window.location.href = '../Select/index.html';
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
function saveCurrentRun(stage) {
    savedStage = stage;
    return saveGameDataToBackend(player.checkpointStats(stage));
}

function levelAccuracyText(stageCount) { return player.levelAccuracyText(stageCount); }

async function saveGameDataToBackend(data) {

    const grade = sessionStorage.getItem('grade') || sessionStorage.getItem('student1_grade');
    const caseId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case');
    const school = sessionStorage.getItem('school') || sessionStorage.getItem('student1_school');
    // 未取得登入學生資料時，不送出成績，避免將未登入的成績寫入正式資料庫。
    if (!grade || !caseId || !school) {
        console.warn('找不到登入學生資料，成績不送出');
        return;
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
            stats: buildEftStats(data),
        },
    };

    try {
        const res = await window.WebGameApi.submitSession(payload);
        if (res.status !== 201) {
            const errData = await res.json().catch(() => ({}));
            console.error(`成績送出失敗 ${res.status}:`, errData.detail || '寫入失敗');
        }
    } catch (err) {
        console.error('成績送出失敗：', err);
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
    const checkpoint = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
    if (checkpoint && checkpoint !== savedStage) await saveCurrentRun(checkpoint);
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
    $('restart').addEventListener('click', startGame);
    $('btn-lobby-finish').addEventListener('click', returnToLobby);
    $('btn-continue').addEventListener('click', handleContinue);
    $('btn-lobby').addEventListener('click', handleMidBreakLobby);
}

function preloadGameAssets() {
    const studentId = sessionStorage.getItem('caseId')
        || sessionStorage.getItem('student1_case')
        || 'S001';
    preloadEftAssets({ studentId }).then((arrowAssets) => {
        player.setArrowAssets(arrowAssets);
        startGame();
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
preloadGameAssets();
