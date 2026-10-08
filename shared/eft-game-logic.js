export const EFT_ARROW_STYLES = Object.freeze([
  Object.freeze({ normal: 6122, opposite: 6118 }),
  Object.freeze({ normal: 6130, opposite: 6126 }),
  Object.freeze({ normal: 6138, opposite: 6134 }),
  Object.freeze({ normal: 6146, opposite: 6142 })
]);

export function shuffleCopy(items, random = Math.random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const otherIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
  }
  return shuffled;
}

export function createQuestion(random = Math.random, styleCount = EFT_ARROW_STYLES.length) {
  const availableStyles = Math.max(1, Math.floor(styleCount));
  return {
    direction: random() < 0.5 ? 'right' : 'left',
    opposite: random() < 0.5,
    style: Math.floor(random() * availableStyles),
  };
}

export function getArrowAssetPath(style, direction, opposite) {
  const number = EFT_ARROW_STYLES[style][opposite ? 'opposite' : 'normal']
    + (direction === 'left' ? 2 : 3);
  return `assets/${opposite ? 'opposite_arrow' : 'arrow'}/IMG_${number}.PNG`;
}

export function getExpectedDirection(question) {
  if (!question.opposite) return question.direction;
  return question.direction === 'left' ? 'right' : 'left';
}

export function levelAccuracyText(levelAccuracies, stageCount) {
  return levelAccuracies
    .slice(0, stageCount)
    .map((value) => Number(value.toFixed(4)))
    .join(',');
}

// 漂浮泡泡（EFT）的成績，前綴是 EFT_。
export function buildEftStats(data) {
  return [
    { apiname: 'EFT_correct', value: data.score },
    { apiname: 'EFT_wrong', value: data.wrong },
    { apiname: 'EFT_accuracy', value: data.accuracy },
    { apiname: 'EFT_duration', value: data.duration },
    { apiname: 'EFT_stage', value: data.stage },
    { apiname: 'EFT_levelAccuracy', value: data.levelAccuracy },
    { apiname: 'EFT_avgReactionMs', value: data.avgReactionMs },
    { apiname: 'EFT_questionCount', value: data.questionCount },
  ];
}