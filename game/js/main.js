// 獨立執行殼（SPEC 4.14）。可嵌入的公開 API 在 dccs.js。

import { mountDCCS } from './dccs.js';

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    grade: params.get('grade'),
    caseId: params.get('caseId'),
    school: params.get('school'),
    currentDay: params.get('currentDay'),
    seed: params.get('seed'),
  };
}

function needsForm(query) {
  return !query.grade || !query.caseId || !query.school || !query.currentDay;
}

function waitForForm(initial) {
  return new Promise((resolve) => {
    const form = document.getElementById('setup-form');
    form.hidden = false;

    if (initial.grade) form.grade.value = initial.grade;
    if (initial.caseId) form.caseId.value = initial.caseId;
    if (initial.school) form.school.value = initial.school;
    if (initial.currentDay) form.currentDay.value = initial.currentDay;

    form.addEventListener(
      'submit',
      (e) => {
        e.preventDefault();
        form.hidden = true;
        resolve({
          grade: form.grade.value.trim(),
          caseId: form.caseId.value.trim(),
          school: form.school.value.trim(),
          currentDay: form.currentDay.value.trim(),
        });
      },
      { once: true }
    );
  });
}

function parseSeed(seedParam) {
  if (seedParam === null || seedParam === '') return undefined;
  const n = Number(seedParam);
  return Number.isNaN(n) ? undefined : n;
}

async function main() {
  const query = parseQuery();

  const student = needsForm(query)
    ? await waitForForm(query)
    : {
        grade: query.grade,
        caseId: query.caseId,
        school: query.school,
        currentDay: query.currentDay,
      };

  const seed = parseSeed(query.seed);
  const container = document.getElementById('game-root');

  const handle = mountDCCS({ container, student, seed });
  await handle.done;
}

main().catch((err) => {
  // mountDCCS 會顯示遊戲內錯誤；這裡只捕捉殼層錯誤。
  console.error(err);
});
