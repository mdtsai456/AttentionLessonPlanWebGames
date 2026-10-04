// 測試共用：受測網站根目錄與頁面清單。
// SITE_ROOT 可指向別的 checkout（例如修正前的版本），用來確認測試抓得到 bug。
import path from "node:path";

export const SITE_ROOT = path.resolve(
  process.env.SITE_ROOT || path.join(import.meta.dirname, "..", "..")
);

// 010 範圍：學生單人模式的 10 頁，加上本來就有守門的 DCCS 遊戲頁。
export const GUARDED_PAGES = [
  "Select/index.html",
  "tutorial/DCCS_tutorial.html",
  "tutorial/DAT_tutorial.html",
  "tutorial/EFT_tutorial.html",
  "tutorial/TGame_tutorial.html",
  "tutorial/InstructionGame_tutorial.html",
  "DAT_single/DAT_single.html",
  "EFT_single/EFT_single.html",
  "TGame1/index.html",
  "IM1/index.html",
];
export const DCCS_PAGE = "DCCS/index.html";
export const ALL_STUDENT_PAGES = [...GUARDED_PAGES, DCCS_PAGE];
