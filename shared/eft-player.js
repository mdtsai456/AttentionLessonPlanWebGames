import {
    createQuestion,
    getArrowAssetPath,
    getExpectedDirection,
    levelAccuracyText,
    shuffleCopy,
} from './eft-game-logic.js';
import {
    ASSET_EMPTY_BUBBLE,
    ASSET_OPPOSITE_HINT,
    ASSET_TARGET_BUBBLE,
    DEFAULT_ARROW_STYLE,
    getArrowPlaceholderPath,
} from './eft-assets.js';

const STAGE_COUNT = 6;
const STAGE_MS = 60_000;
const ANSWER_LIMIT_MS = 10_000;
const FEEDBACK_MS = 1100;
const TARGET_MS = 1000;
const POSITIONS = [{ x: 10, y: 36 }, { x: 40, y: 3 }, { x: 72, y: 43 }];

export function createEftPlayer({
    root,
    getUi,
    keyBindings = {},
    onStageEnd,
    onFinished = () => {},
    onGameStart = () => {},
    onReset = () => {},
    focusRestart = false,
    random = Math.random,
}) {
    const buttons = [...root.querySelectorAll('[data-direction]')];
    const panel = root.querySelector('.answer-panel');
    let question = null, index = 0, score = 0, phase = 'intro', timer;
    let outcomes = [], reactionSamples = [], answerStartedAt = 0;
    let startTimeMs = 0;
    let stage = 1, stageQuestion = 0, stageStartedAt = 0, stageOutcomes = [], levelAccuracies = [];
    let arrowAssets = [...DEFAULT_ARROW_STYLE];
    let arrowStyleIndex = 0, consecutiveCorrect = 0;
    let clockId = 0;

    function setEnabled(enabled) {
        buttons.forEach((button) => { button.disabled = !enabled; });
    }

    function stageRemaining() {
        return stageStartedAt ? STAGE_MS - (Date.now() - stageStartedAt) : STAGE_MS;
    }

    function updateProgress() {
        const used = stageStartedAt ? Math.min(STAGE_MS, Date.now() - stageStartedAt) : 0;
        const ratio = ((stage - 1) + used / STAGE_MS) / STAGE_COUNT;
        getUi('progress-fill').style.height = `${Math.min(100, ratio * 100)}%`;
        root.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', index);
        const secondsLeft = Math.max(0, Math.ceil(stageRemaining() / 1000));
        getUi('round').textContent = `第 ${stageQuestion} 題・剩餘 ${secondsLeft} 秒（第 ${stage} / ${STAGE_COUNT} 關）`;
    }

    function startStageClock() {
        clearInterval(clockId);
        clockId = setInterval(() => {
            if (phase === 'break' || phase === 'stage_clear' || phase === 'finished') return;
            updateProgress();
        }, 200);
    }

    function stopStageClock() {
        clearInterval(clockId);
    }

    function makeQuestion() {
        return { ...createQuestion(random, arrowAssets.length), style: arrowStyleIndex };
    }

    function setArrowAssets(assets) {
        arrowAssets = Array.isArray(assets) && assets.length ? [...assets] : [...DEFAULT_ARROW_STYLE];
        arrowStyleIndex = 0;
        consecutiveCorrect = 0;
    }

    function shuffle(items) {
        items.splice(0, items.length, ...shuffleCopy(items, random));
        return items;
    }

    function asset(style, direction, opposite) {
        return getArrowAssetPath(style, direction, opposite);
    }

    function createBubble(field, position, layers, label) {
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.style.left = `${position.x}%`;
        bubble.style.top = `${position.y}%`;
        bubble.setAttribute('role', 'img');
        bubble.setAttribute('aria-label', label);
        layers.forEach(({ src, zIndex, flipHorizontal = false }) => {
            const image = document.createElement('img');
            image.src = src;
            image.alt = '';
            image.draggable = false;
            image.setAttribute('aria-hidden', 'true');
            image.style.zIndex = zIndex;
            if (flipHorizontal) image.style.transform = 'scaleX(-1)';
            bubble.append(image);
        });
        field.append(bubble);
    }

    function renderMemoryBubbles(field, positions) {
        createBubble(field, positions[0], [
            { src: ASSET_TARGET_BUBBLE, zIndex: 0 },
        ], '黃色目標泡泡');
        for (let positionIndex = 1; positionIndex < positions.length; positionIndex++) {
            createBubble(field, positions[positionIndex], [
                { src: ASSET_EMPTY_BUBBLE, zIndex: 0 },
            ], '空泡泡');
        }
    }

    function renderAnswerBubbles(field, positions) {
        for (let positionIndex = 0; positionIndex < positions.length; positionIndex++) {
            const direction = positionIndex === 0 ? question.direction : pick(['left', 'right']);
            const style = arrowStyleIndex;
            const label = `泡泡：${question.opposite ? '紅色虛線，' : ''}箭頭向${direction === 'left' ? '左' : '右'}`;
            const layers = [
                { src: ASSET_EMPTY_BUBBLE, zIndex: 0 },
                {
                    src: getArrowPlaceholderPath(style, arrowAssets),
                    zIndex: 1,
                    flipHorizontal: direction === 'right',
                },
            ];
            if (question.opposite) {
                layers.push({ src: ASSET_OPPOSITE_HINT, zIndex: 2 });
            }
            createBubble(field, positions[positionIndex], layers, label);
        }
    }

    function pick(items) {
        return items[Math.floor(random() * items.length)];
    }

    function beginAnswerPhase() {
        phase = 'answer';
        answerStartedAt = Date.now();
        getUi('feedback').textContent = '回答剛才位置的泡泡';
        setEnabled(true);
        const remaining = stageRemaining();
        const wait = Math.min(ANSWER_LIMIT_MS, Math.max(0, remaining));
        const timeoutMessage = remaining <= ANSWER_LIMIT_MS
            ? '本關時間到，這題算錯'
            : '10 秒未作答，這題算錯';
        timer = setTimeout(() => missQuestion(timeoutMessage), wait);
    }

    function renderQuestion() {
        clearTimeout(timer);
        if (stageRemaining() <= 0) {
            endStage();
            return;
        }
        phase = 'memory';
        setEnabled(false);
        delete panel.dataset.result;
        getUi('feedback').textContent = '記住黃色泡泡的位置';
        stageQuestion += 1;
        question = makeQuestion();
        updateProgress();
        const field = getUi('bubble-field');
        const positions = shuffleCopy(POSITIONS, random);
        field.replaceChildren();
        renderMemoryBubbles(field, positions);
        const memoryMs = Math.min(TARGET_MS, Math.max(0, stageRemaining()));
        timer = setTimeout(() => {
            if (phase !== 'memory') return;
            if (stageRemaining() <= 0) {
                missQuestion('本關時間到，這題算錯');
                return;
            }
            field.replaceChildren();
            renderAnswerBubbles(field, positions);
            beginAnswerPhase();
        }, memoryMs);
    }

    function beginStage(nextStage) {
        stage = nextStage;
        stageQuestion = 0;
        stageOutcomes = [];
        stageStartedAt = Date.now();
        startStageClock();
        renderQuestion();
    }

    function resetGame() {
        clearTimeout(timer);
        stopStageClock();
        question = null;
        index = 0;
        score = 0;
        phase = 'intro';
        outcomes = [];
        reactionSamples = [];
        answerStartedAt = 0;
        startTimeMs = 0;
        stage = 1;
        stageQuestion = 0;
        stageStartedAt = 0;
        stageOutcomes = [];
        levelAccuracies = [];
        arrowStyleIndex = 0;
        consecutiveCorrect = 0;
        setEnabled(false);
        getUi('bubble-field').replaceChildren();
        delete panel.dataset.result;
        getUi('score').textContent = '0 分';
        getUi('feedback').textContent = '請看亮起的泡泡';
        getUi('results').hidden = true;
        updateProgress();
        onReset();
    }

    function startGame() {
        resetGame();
        startTimeMs = Date.now();
        onGameStart(startTimeMs);
        beginStage(1);
    }

    function recordOutcome(correct, reactionMs) {
        reactionSamples.push(reactionMs);
        outcomes.push(correct);
        stageOutcomes.push(correct);
        if (correct) {
            score++;
            consecutiveCorrect++;
            if (consecutiveCorrect === 5) {
                arrowStyleIndex = Math.min(arrowStyleIndex + 1, arrowAssets.length - 1);
                consecutiveCorrect = 0;
            }
        } else {
            consecutiveCorrect = 0;
            arrowStyleIndex = Math.max(arrowStyleIndex - 1, 0);
        }
        index++;
        getUi('score').textContent = `${score} 分`;
        updateProgress();
    }

    function continueAfterFeedback() {
        if (stageRemaining() <= 0) endStage();
        else renderQuestion();
    }

    function missQuestion(message) {
        if (phase !== 'answer' && phase !== 'memory') return;
        const reactionMs = phase === 'answer' ? Math.max(0, Date.now() - answerStartedAt) : 0;
        phase = 'feedback';
        setEnabled(false);
        clearTimeout(timer);
        recordOutcome(false, reactionMs);
        panel.dataset.result = 'wrong';
        getUi('feedback').textContent = message;
        timer = setTimeout(continueAfterFeedback, FEEDBACK_MS);
    }

    function finishGame() {
        phase = 'finished';
        stopStageClock();
        const total = Math.max(index, 1);
        getUi('final-score').textContent = `${score} / ${index} 分`;
        getUi('accuracy').textContent = `答對 ${score} 題・正確率 ${Math.round(score / total * 100)}%`;
        getUi('results').hidden = false;
        if (focusRestart) getUi('restart').focus();
        onFinished(getState());
    }

    function endStage() {
        if (phase === 'break' || phase === 'stage_clear' || phase === 'finished') return;
        stopStageClock();
        clearTimeout(timer);
        setEnabled(false);
        const hits = stageOutcomes.filter(Boolean).length;
        levelAccuracies[stage - 1] = stageOutcomes.length ? hits / stageOutcomes.length : 0;
        const finished = stage;
        if (onStageEnd) {
            onStageEnd({
                stage: finished,
                setPhase: (nextPhase) => { phase = nextPhase; },
                setFeedback: (message) => { getUi('feedback').textContent = message; },
                resume: () => beginStage(finished + 1),
                finish: finishGame,
            });
            return;
        }
        finishGame();
    }

    function answer(direction) {
        if (phase !== 'answer') return;
        phase = 'feedback';
        setEnabled(false);
        clearTimeout(timer);
        const expected = getExpectedDirection(question);
        const correct = direction === expected;
        recordOutcome(correct, Math.max(0, Date.now() - answerStartedAt));
        panel.dataset.result = correct ? 'correct' : 'wrong';
        const message = correct
            ? '答對了！＋1 分'
            : `${question.opposite ? '虛線要反向！' : '再加油！'}應選${expected === 'left' ? '左 ←' : '右 →'}`;
        getUi('feedback').textContent = message;
        timer = setTimeout(continueAfterFeedback, FEEDBACK_MS);
    }

    buttons.forEach((button) => button.addEventListener('click', () => answer(button.dataset.direction)));
    document.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
        if (phase === 'answer' && keyBindings[event.code]) {
            event.preventDefault();
            if (!event.repeat) answer(keyBindings[event.code]);
        }
    });

    function getState() {
        return {
            question,
            index,
            score,
            phase,
            reactionSamples: [...reactionSamples],
            answerStartedAt,
            startTimeMs,
            stage,
            stageQuestion,
            stageStartedAt,
            stageOutcomes: [...stageOutcomes],
            levelAccuracies: [...levelAccuracies],
            arrowStyleIndex,
            consecutiveCorrect,
        };
    }

    function completedStages() {
        if (phase === 'finished' || phase === 'break' || phase === 'stage_clear') return stage;
        return Math.max(0, stage - 1);
    }

    return {
        answer,
        asset,
        beginStage,
        completedStages,
        continueAfterFeedback,
        endStage,
        finishGame,
        getState,
        levelAccuracyText: (stageCount) => levelAccuracyText(levelAccuracies, stageCount),
        makeQuestion,
        missQuestion,
        recordOutcome,
        renderQuestion,
        resetGame,
        setArrowAssets,
        setEnabled,
        setPhase: (nextPhase) => { phase = nextPhase; },
        shuffle,
        stageRemaining,
        startGame,
        startStageClock,
        stopStageClock,
        updateProgress,
    };
}