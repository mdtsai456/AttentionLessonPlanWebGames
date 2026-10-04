import { buildDatStats } from '../shared/eft-game-logic.js';
import { preloadEftAssets } from '../shared/eft-assets.js';
import { createEftPlayer } from '../shared/eft-player.js';

// 每關 60 秒、共 6 關。時間內答完就繼續出題；單題 10 秒沒答算錯並換下一題。
const STAGE_COUNT = 6;
const MID_STAGE = 3;

// DOM and game state
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

// Randomization and asset helpers
function shuffle(items) { return player.shuffle(items); }
function asset(style, direction, opposite) { return player.asset(style, direction, opposite); }
function setEnabled(enabled) { player.setEnabled(enabled); }

// Stage clock and progress UI
function stageRemaining() { return player.stageRemaining(); }
function updateProgress() { player.updateProgress(); }
function startStageClock() { player.startStageClock(); }
function stopStageClock() { player.stopStageClock(); }
function makeQuestion() { return player.makeQuestion(); }
function renderQuestion() { player.renderQuestion(); }

// Game and stage lifecycle
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

function saveCurrentRun(stage) {
    savedStage = stage;
    const state = player.getState();
    const total = Math.max(state.index, 1);
    const avgReactionMs = state.reactionSamples.length
        ? state.reactionSamples.reduce((sum, value) => sum + value, 0) / state.reactionSamples.length
        : 0;
    return saveGameDataToBackend({
        score: state.score,
        wrong: Math.max(total - state.score, 0),
        accuracy: state.score / total,
        duration: Date.now() - gameStartTime,
        stage,
        levelAccuracy: levelAccuracyText(stage),
        avgReactionMs,
        questionCount: state.index,
    });
}

function levelAccuracyText(stageCount) { return player.levelAccuracyText(stageCount); }

async function saveGameDataToBackend(data) {
    const url = `${window.WebGameApi.resolveApiBase()}/sessions`;
    const grade = sessionStorage.getItem('grade') || sessionStorage.getItem('student1_grade') || 'G1';
    const caseId = sessionStorage.getItem('caseId') || sessionStorage.getItem('student1_case') || 'S03';
    const school = sessionStorage.getItem('school') || sessionStorage.getItem('student1_school') || 'KMU';
    const currentDay = parseInt(
        sessionStorage.getItem('currentDay')
        || sessionStorage.getItem('student1_day')
        || sessionStorage.getItem('current_day')
        || '1',
        10
    );

    const payload = {
        lessonId: '1140908_DAT',
        data: {
            grade,
            caseId,
            school,
            currentDay,
            startTime: gameStartTime,
            endTime: Date.now(),
            mode: 'single',
            stats: buildDatStats(data),
        },
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
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

// Event handlers and startup
function handleKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const overlay = !$('results').hidden ? $('results') : (!$('mid-break-modal').hidden ? $('mid-break-modal') : null);
    if (overlay && event.key === 'Tab') {
        event.preventDefault(); overlay.querySelector('button').focus();
    }
}

async function leaveGame() {
    $('leave-btn').disabled = true;
    const state = player.getState();
    const completed = state.phase === 'finished' || state.phase === 'break' || state.phase === 'stage_clear'
        ? state.stage
        : state.stage - 1;
    const checkpoint = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
    if (checkpoint && checkpoint !== savedStage) await saveCurrentRun(checkpoint);
    window.askLeave('../Select/index.html');
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

// Keep classic-script function names callable while containing implementation in a module.
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
