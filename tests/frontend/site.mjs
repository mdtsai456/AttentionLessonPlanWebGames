// 測試共用：受測網站根目錄與頁面清單。
// SITE_ROOT 可指向別的 checkout（例如修正前的版本），用來確認測試抓得到 bug。
import path from "node:path";

export const SITE_ROOT = path.resolve(
  process.env.SITE_ROOT || path.join(import.meta.dirname, "..", "..")
);

export const DCCS_PAGE = "DCCS_single/index.html";

// 010 範圍：全部 11 個學生單人頁共用相同登入守門。
export const GUARDED_PAGES = [
  "Select/index.html",
  "Tutorial/DCCS_tutorial.html",
  "Tutorial/DAT_tutorial.html",
  "Tutorial/EFT_tutorial.html",
  "Tutorial/TGame_tutorial.html",
  "Tutorial/InstructionGame_tutorial.html",
  DCCS_PAGE,
  "DAT_single/DAT_single.html",
  "EFT_single/EFT_single.html",
  "TGame_single/index.html",
  "IM_single/index.html",
];

export const DOUBLE_PAGES = [
  'Tutorial/DCCS_double_tutorial.html', 'Tutorial/DAT_double_tutorial.html',
  'Tutorial/EFT_double_tutorial.html', 'Tutorial/TGame_double_tutorial.html',
  'DCCS_double/index.html', 'DAT_double/DAT_double.html', 'EFT_double/EFT_double.html', 'TGame_double/index.html',
];
