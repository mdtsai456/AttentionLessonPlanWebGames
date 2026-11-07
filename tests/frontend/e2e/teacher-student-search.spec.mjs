// 老師後台學生選單旁的搜尋框：輸入學生 ID 即時過濾選單。
import { test, expect } from '@playwright/test';
import { TEACHER, loginAs, routeStudents, readStudentGroups } from './helpers.mjs';

const STUDENTS = [['G1', 'S001', 0], ['G1', 'S012', 2], ['G2', 'S013', 0], ['G2', 'S120', 1]];

async function openTeacherPage(page) {
  await loginAs(page, TEACHER);
  await page.goto('Teacher_platform/index.html');
  await expect(page.locator('#student-select optgroup')).not.toHaveCount(0);
}

test('輸入部分 ID 只留下符合的學生，沒有學生的年級整組隱藏', async ({ page }) => {
  await routeStudents(page, STUDENTS);
  await openTeacherPage(page);

  await page.locator('#student-search').fill('S01');
  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G1', options: ['個案 G1_S012（已測 2 場）'] },
    { label: 'G2', options: ['個案 G2_S013（已測 0 場）'] },
  ]);

  await page.locator('#student-search').fill('S12');
  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G2', options: ['個案 G2_S120（已測 1 場）'] },
  ]);
});

test('不分大小寫，可以連年級一起搜；前後空白會忽略', async ({ page }) => {
  await routeStudents(page, STUDENTS);
  await openTeacherPage(page);

  await page.locator('#student-search').fill('  g2_s01 ');
  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G2', options: ['個案 G2_S013（已測 0 場）'] },
  ]);
});

test('找不到時提示「找不到符合的學生」，清空搜尋框後恢復完整名單', async ({ page }) => {
  await routeStudents(page, STUDENTS);
  await openTeacherPage(page);

  await page.locator('#student-search').fill('S999');
  await expect(page.locator('#student-select option')).toHaveText(['找不到符合的學生']);

  await page.locator('#student-search').fill('');
  await expect(page.locator('#student-select option')).toHaveCount(5);
  await expect(page.locator('#student-select option').first()).toHaveText('請選擇學生');
});

test('已選的學生不會被搜尋濾掉，報表維持顯示', async ({ page }) => {
  await routeStudents(page, STUDENTS);
  await openTeacherPage(page);
  await page.locator('#student-select').selectOption('G1_S001');
  await expect(page.locator('#view-student-key')).toContainText('G1_S001');

  await page.locator('#student-search').fill('S12');
  await expect.poll(() => readStudentGroups(page)).toEqual([
    { label: 'G1', options: ['個案 G1_S001（已測 0 場）'] },
    { label: 'G2', options: ['個案 G2_S120（已測 1 場）'] },
  ]);
  await expect(page.locator('#student-select')).toHaveValue('G1_S001');
  await expect(page.locator('#report-view')).toBeVisible();

  await page.locator('#student-select').selectOption('G2_S120');
  await expect(page.locator('#view-student-key')).toContainText('G2_S120');
});

test('名單讀取失敗時搜尋框停用', async ({ page }) => {
  await page.route('**/api/me/students', (route) => route.fulfill({ status: 500, body: '{}' }));
  await loginAs(page, TEACHER);
  await page.goto('Teacher_platform/index.html');

  await expect(page.locator('#student-select option')).toHaveText(['學生名單讀取失敗']);
  await expect(page.locator('#student-search')).toBeDisabled();
});

test('沒有任何學生時仍顯示「請選擇學生」，不是「找不到」', async ({ page }) => {
  await routeStudents(page, []);
  await loginAs(page, TEACHER);
  await page.goto('Teacher_platform/index.html');

  await expect(page.locator('#student-select option')).toHaveText(['請選擇學生']);
  await expect(page.locator('#student-search')).toBeEnabled();
});
