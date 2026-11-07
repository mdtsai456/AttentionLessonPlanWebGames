// 老師後台的學生選單：依年級分組，同一年級內有施測紀錄的學生排前面，已測 0 場的排最後。
import { test, expect } from '@playwright/test';
import { TEACHER, loginAs, routeStudents, readStudentGroups } from './helpers.mjs';

async function openTeacherPage(page) {
  await loginAs(page, TEACHER);
  await page.goto('Teacher_platform/index.html');
}

test('依年級分組，同年級內已測 0 場的學生排到最後，其餘維持後端順序', async ({ page }) => {
  await routeStudents(page, [
    ['G1', 'S001', 0], ['G1', 'S002', 3], ['G1', 'S003', 0], ['G1', 'S004', 1],
    ['G2', 'S005', 0], ['G2', 'S006', 2],
  ]);
  await openTeacherPage(page);

  await expect(page.locator('#student-select option').first()).toHaveText('請選擇學生');
  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G1', options: ['個案 G1_S002（已測 3 場）', '個案 G1_S004（已測 1 場）', '個案 G1_S001（已測 0 場）', '個案 G1_S003（已測 0 場）'] },
    { label: 'G2', options: ['個案 G2_S006（已測 2 場）', '個案 G2_S005（已測 0 場）'] },
  ]);
});

test('多個場域時同年級併成一組，年級依數字排序（G2 在 G10 前）', async ({ page }) => {
  await routeStudents(page, [['G10', 'S01', 1, 'A'], ['G2', 'S01', 0, 'A'], ['G2', 'S02', 4, 'B']]);
  await openTeacherPage(page);

  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G2', options: ['個案 G2_S02（已測 4 場）', '個案 G2_S01（已測 0 場）'] },
    { label: 'G10', options: ['個案 G10_S01（已測 1 場）'] },
  ]);
});

test('後端沒給 sessionCount 時顯示「已測 0 場」並排在最後', async ({ page }) => {
  await routeStudents(page, [['G1', 'S01', undefined], ['G1', 'S02', 2]]);
  await openTeacherPage(page);

  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G1', options: ['個案 G1_S02（已測 2 場）', '個案 G1_S01（已測 0 場）'] },
  ]);
});

test('分組後選學生仍能展開該學生的報表', async ({ page }) => {
  await routeStudents(page, [['G1', 'S001', 0], ['G2', 'S002', 1]]);
  await openTeacherPage(page);

  await page.locator('#student-select').selectOption('G2_S002');
  await expect(page.locator('#view-student-key')).toContainText('G2_S002');
  await expect(page.locator('#empty-hint')).toBeHidden();
});
