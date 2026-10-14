import { buildEftStats } from '../shared/eft-game-logic.js';
import { preloadEftAssets } from '../shared/eft-assets.js';
import { createEftPlayer } from '../shared/eft-player.js';

// 每關 60 秒，共 6 關。關卡時間內持續出題。單題 10 秒未作答時，計為錯誤並換題。
const STAGE_COUNT = 6;
const MID_STAGE = 3;

function handlePlayerStageEnd(playerIndex, { stage, setPhase, setFeedback, resume, finish }) {
    if (stage === MID_STAGE) {
        setPhase('break');
        setFeedback('第 3 關已結束，等待另一位玩家');
        waitForMidBreak(playerIndex, resume);
        return;
    }
    if (stage < STAGE_COUNT) {
        setPhase('stage_clear');
        setFeedback(`第 ${stage} 關已結束，等待另一位玩家`);
        waitForStageClear(playerIndex, stage, resume);
        return;
    }
    finish();
}

function getPlayerIdentity(playerIndex) {
    const isP1 = playerIndex === 0;
    const studentKey = sessionStorage.getItem(isP1 ? 'student1_key' : 'student2_key') || '';
    const caseId =
        sessionStorage.getItem(isP1 ? 'student1_case' : 'student2_case') ||
        (studentKey.includes('_') ? studentKey.slice(studentKey.indexOf('_') + 1) : studentKey);
    return {
        grade: sessionStorage.getItem(isP1 ? 'student1_grade' : 'student2_grade'),
        school: sessionStorage.getItem(isP1 ? 'student1_school' : 'student2_school'),
        caseId,
        currentDay: parseInt(
            sessionStorage.getItem(isP1 ? 'student1_day' : 'student2_day')
            || (isP1 ? sessionStorage.getItem('current_day') || sessionStorage.getItem('currentDay') : '')
            || '1',
            10
        ),
    };
}

function buildPlayerStats(player, state, stage) {
    const total = Math.max(state.index, 1);
    const avgReactionMs = state.reactionSamples.length
        ? state.reactionSamples.reduce((sum, value) => sum + value, 0) / state.reactionSamples.length
        : 0;
    return buildEftStats({
        score: state.score,
        wrong: Math.max(total - state.score, 0),
        accuracy: state.score / total,
        duration: window.WebGameRuntime.now() - state.startTimeMs,
        stage,
        levelAccuracy: player.levelAccuracyText(stage),
        avgReactionMs,
        questionCount: state.index,
    });
}

// 漂浮泡泡的成績使用 EFT 寫入。素材 API 也使用 EFT 查詢。
async function savePlayerRun(player, playerIndex, stage) {
    const identity = getPlayerIdentity(playerIndex);
    const state = player.getState();
    await window.WebGameApi.submitSession({
            lessonId: '1140908_EFT',
            data: {
                ...identity,
                startTime: state.startTimeMs,
                endTime: Date.now(),
                mode: 'double',
                pairId,
                stats: buildPlayerStats(player, state, stage),
            },
        }, { player: playerIndex + 1 }).catch((error) => console.error(error));
}

function createPlayer(element, keyBindings, playerIndex) {
    const player = createEftPlayer({
        root: element,
        getUi: (id) => element.querySelector(`[data-ui="${id}"]`),
        keyBindings,
        onStageEnd: (state) => handlePlayerStageEnd(playerIndex, state),
    });
    element.querySelector('[data-ui="restart"]').addEventListener('click', player.startGame);
    return {
        startGame: player.startGame,
        completedStages: player.completedStages,
        setArrowAssets: player.setArrowAssets,
        saveRun: (stage) => savePlayerRun(player, playerIndex, stage),
    };
}

// 兩位玩家的題目、計時與分數各自獨立。
export const players = [
    createPlayer(document.querySelector('.player-1'), { KeyA: 'left', KeyD: 'right' }, 0),
    createPlayer(document.querySelector('.player-2'), { ArrowLeft: 'left', ArrowRight: 'right' }, 1)
];

const midWait = [false, false];
const midResume = [null, null];

const stageWait = [null, null];
const stageResume = [null, null];

function waitForStageClear(playerIndex, level, resume) {
    stageWait[playerIndex] = level;
    stageResume[playerIndex] = resume;
    if (stageWait[0] !== level || stageWait[1] !== level) return;
    window.showStageClear(level).then(() => {
        const resumes = stageResume.slice();
        stageWait[0] = stageWait[1] = null;
        stageResume[0] = stageResume[1] = null;
        resumes.forEach((fn) => fn && fn());
    });
}

function waitForMidBreak(playerIndex, resume) {
    midWait[playerIndex] = true;
    midResume[playerIndex] = resume;
    if (midWait[0] && midWait[1]) {
        document.getElementById('mid-break').hidden = false;
    }
}

document.getElementById('mid-continue').addEventListener('click', () => {
    const resumes = midResume.slice();
    midWait[0] = midWait[1] = false;
    midResume[0] = midResume[1] = null;
    document.getElementById('mid-break').hidden = true;
    resumes.forEach((resume) => resume && resume());
});
let pairId = `${window.WebGameRuntime.now()}`;

document.getElementById('leave-btn').addEventListener('click', async () => {
    const completed = Math.min(...players.map((player) => player.completedStages()));
    const stage = completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
    if (stage) await Promise.all(players.map((player) => player.saveRun(stage)));
    window.askLeave('../Select/index.html');
});

document.getElementById('mid-lobby').addEventListener('click', () => {
    window.location.href = '../Select/index.html';
});

// 預載素材後，同時開始兩位玩家的第一題。
Promise.all(players.map((player, playerIndex) => preloadEftAssets({
    studentId: getPlayerIdentity(playerIndex).caseId,
    backgroundAssets: playerIndex === 0 ? ['assets/background.png'] : [],
}))).then((arrowAssetsByPlayer) => {
    players.forEach((player, playerIndex) => {
        player.setArrowAssets(arrowAssetsByPlayer[playerIndex]);
        player.startGame();
    });
}).catch((error) => {
    console.error('EFT 雙人載入或啟動失敗：', error);
    document.querySelectorAll('[data-ui="feedback"]').forEach((feedback) => {
        feedback.textContent = '圖片載入失敗，請重新整理';
    });
});
