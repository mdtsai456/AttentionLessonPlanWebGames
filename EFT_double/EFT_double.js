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
        // 到中場就先送自己的第 3 關，之後直接關掉頁面也保得住前三關。
        void players[playerIndex].saveRun(MID_STAGE);
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

// 同一局兩人共用 pairId；再玩一次時兩人一起開新局並換新的 pairId。
let pairId = '';
// 這一局的 submissionId：中場先送的第 3 關與打完的第 6 關共用，後端用較高關卡更新同一列。
// 後端以「學生身分 + submissionId」區分，兩位玩家共用同一個值也不會撞在一起。
let playId = '';
// 兩人都打完六關才開放「再玩一次」，避免先打完的人把還在玩的搭檔一起重設。
const finished = [false, false];

// 漂浮泡泡的成績使用 EFT 寫入。素材 API 也使用 EFT 查詢。
// 回傳伺服器回應。連線失敗時回傳 undefined。
function savePlayerRun(player, playerIndex, stage) {
    const identity = getPlayerIdentity(playerIndex);
    const state = player.getState();
    // 只算到該關結束為止，第 4、5 關中途離開送第 3 關時不含後面關卡；endTime 也是該關結束當下。
    const checkpoint = player.checkpointStats(stage);
    return window.WebGameApi.submitSession({
            lessonId: '1140908_EFT',
            data: {
                ...identity,
                startTime: window.WebGameRuntime.toWallTime(state.startTimeMs),
                endTime: checkpoint.endTime,
                mode: 'double',
                pairId,
                submissionId: playId,
                stats: buildEftStats(checkpoint),
            },
        }, { player: playerIndex + 1 }).catch((error) => console.error(error));
}

function createPlayer(element, keyBindings, playerIndex) {
    // 這一局每個檢查點的送出，key 是關卡。離開、中場返回與六關打完共用，
    // 連點或離開→取消→再離開都只送一次；已送過更後面的檢查點就不再送前面的。
    let submissions = new Map();
    function saveRun(stage) {
        const done = [...submissions.keys()].filter((saved) => saved >= stage);
        if (done.length) return submissions.get(Math.max(...done));
        const currentRun = submissions;
        currentRun.set(stage, savePlayerRun(player, playerIndex, stage).then((response) => {
            // 送失敗時允許下次離開再送。有 submissionId，就算上次其實已寫入，重送也不會多一列。
            if (!response || !response.ok) {
                currentRun.delete(stage);
                console.error(`成績送出失敗 ${response.status}`);
            }
            return response;
        }));
        return currentRun.get(stage);
    }
    function startGame() {
        submissions = new Map();
        player.startGame();
    }
    const player = createEftPlayer({
        root: element,
        getUi: (id) => element.querySelector(`[data-ui="${id}"]`),
        keyBindings,
        onStageEnd: (state) => handlePlayerStageEnd(playerIndex, state),
        onFinished: () => handlePlayerFinished(playerIndex),
    });
    element.querySelector('[data-ui="restart"]').addEventListener('click', startSession);
    return {
        startGame,
        isPlaying: () => !['intro', 'finished'].includes(player.getState().phase),
        completedStages: player.completedStages,
        setArrowAssets: player.setArrowAssets,
        saveRun,
    };
}

// 打完六關立刻送自己的成績；兩人都打完才開放「再玩一次」。
function handlePlayerFinished(playerIndex) {
    finished[playerIndex] = true;
    void players[playerIndex].saveRun(STAGE_COUNT);
    restartButtons.forEach((button) => { button.disabled = !finished.every(Boolean); });
}

const restartButtons = [...document.querySelectorAll('[data-ui="restart"]')];

// 兩位玩家的題目、計時與分數各自獨立。
export const players = [
    createPlayer(document.querySelector('.player-1'), { KeyA: 'left', KeyD: 'right' }, 0),
    createPlayer(document.querySelector('.player-2'), { ArrowLeft: 'left', ArrowRight: 'right' }, 1)
];

// 任一位玩家還沒打完六關就關掉頁面時，先跳瀏覽器的離開詢問。
window.guardUnload(() => players.some((player) => player.isPlaying()));

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

// 開新的一局：兩人一起重來、換新的 pairId，並清掉過關與中場的等待狀態。
function startSession() {
    pairId = window.WebGameApi.uuid();
    playId = window.WebGameApi.uuid();
    finished.fill(false);
    midWait.fill(false);
    midResume.fill(null);
    stageWait.fill(null);
    stageResume.fill(null);
    document.getElementById('mid-break').hidden = true;
    players.forEach((player) => player.startGame());
}

function checkpointStage() {
    const completed = Math.min(...players.map((player) => player.completedStages()));
    return completed >= STAGE_COUNT ? STAGE_COUNT : completed >= MID_STAGE ? MID_STAGE : 0;
}

function saveBoth(stage) {
    if (!stage) return Promise.resolve();
    return Promise.all(players.map((player) => player.saveRun(stage)));
}

const leaveButton = document.getElementById('leave-btn');
// 先在頁面內確認，確定後才送兩人的檢查點並回大廳；取消什麼都不送，遊戲照常繼續。
leaveButton.addEventListener('click', async () => {
    leaveButton.disabled = true;
    if (!(await window.confirmLeave())) {
        leaveButton.disabled = false;
        return;
    }
    await saveBoth(checkpointStage());
    window.leaveTo('../Select/index.html');
    // 從上一頁（bfcache）回來時按鈕要能再按；已送過的檢查點不會重送。
    leaveButton.disabled = false;
});

// 中場返回也先送兩人第 3 關成績，和其他遊戲的中場返回一致。
const midButtons = ['mid-continue', 'mid-lobby'].map((id) => document.getElementById(id));
document.getElementById('mid-lobby').addEventListener('click', async () => {
    midButtons.forEach((button) => { button.disabled = true; });
    try {
        await saveBoth(MID_STAGE);
        window.leaveTo('../Select/index.html');
    } finally {
        // 導頁沒有發生時（例如頁面被攔下）恢復按鈕；已送過的檢查點不會重送。
        midButtons.forEach((button) => { button.disabled = false; });
    }
});

// 預載素材後，同時開始兩位玩家的第一題。
Promise.all(players.map((player, playerIndex) => preloadEftAssets({
    studentId: getPlayerIdentity(playerIndex).caseId,
    backgroundAssets: playerIndex === 0 ? ['assets/background.png'] : [],
}))).then((arrowAssetsByPlayer) => {
    players.forEach((player, playerIndex) => {
        player.setArrowAssets(arrowAssetsByPlayer[playerIndex]);
    });
    startSession();
}).catch((error) => {
    console.error('EFT 雙人載入或啟動失敗：', error);
    document.querySelectorAll('[data-ui="feedback"]').forEach((feedback) => {
        feedback.textContent = '圖片載入失敗，請重新整理';
    });
});
