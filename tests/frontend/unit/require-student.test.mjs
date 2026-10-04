// shared/require-student.js 的單元測試：在 vm 裡執行真正的檔案，
// 只把 sessionStorage、location、document 換成可觀察的假物件。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { SITE_ROOT } from "../site.mjs";

const SCRIPT_PATH = path.join(SITE_ROOT, "shared", "require-student.js");
const SCRIPT_SRC = "https://webgames.test/shared/require-student.js";
const HOME = "https://webgames.test/Home/index.html";

const STUDENT_SINGLE = {
  user_role: "student",
  token: "t1",
  student1_token: "t1",
};

/**
 * 載入守門 script 一次，回傳可觀察的結果。
 * storage 可以在載入後修改，用來模擬之後登出、再從 bfcache 還原。
 */
function loadGuard({
  storage = {},
  storageThrows = false,
  scriptSrc = SCRIPT_SRC,
  pageHref = "https://webgames.test/Select/index.html",
} = {}) {
  const code = fs.readFileSync(SCRIPT_PATH, "utf8");
  const replaced = [];
  const listeners = {};
  const sessionStorage = {
    getItem(key) {
      if (storageThrows) throw new Error("SecurityError: storage disabled");
      return Object.hasOwn(storage, key) ? storage[key] : null;
    },
  };
  const window = {
    location: {
      href: pageHref,
      replace: (url) => replaced.push(url),
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
  };
  const document = {
    currentScript: scriptSrc ? { src: scriptSrc } : null,
    documentElement: { style: {} },
  };
  vm.runInNewContext(code, { window, document, sessionStorage, URL });

  return {
    storage,
    replaced,
    style: document.documentElement.style,
    firePageshow(persisted) {
      (listeners.pageshow || []).forEach((fn) => fn({ persisted }));
    },
  };
}

test("未登入（sessionStorage 全空）會導回 Home 並先藏起頁面", () => {
  const page = loadGuard();
  assert.deepEqual(page.replaced, [HOME]);
  assert.equal(page.style.visibility, "hidden");
});

test("老師登入（有 token）也會導回 Home", () => {
  const page = loadGuard({
    storage: { user_role: "teacher", login_role: "teacher", token: "teacher-token" },
  });
  assert.deepEqual(page.replaced, [HOME]);
});

test("user_role 是 student 但沒有任何 token 會導回 Home", () => {
  const page = loadGuard({
    storage: { user_role: "student", grade: "G1", caseId: "S01", school: "KMU" },
  });
  assert.deepEqual(page.replaced, [HOME]);
});

test("有 token 但沒有 user_role 會導回 Home", () => {
  const page = loadGuard({ storage: { token: "t1", student1_token: "t1" } });
  assert.deepEqual(page.replaced, [HOME]);
});

test("token 是空字串視同沒有 token", () => {
  const page = loadGuard({
    storage: { user_role: "student", token: "", student1_token: "" },
  });
  assert.deepEqual(page.replaced, [HOME]);
});

test("學生登入（Home 寫入的完整欄位）不跳轉、不藏頁面", () => {
  const page = loadGuard({ storage: { ...STUDENT_SINGLE, grade: "G1", caseId: "S01" } });
  assert.deepEqual(page.replaced, []);
  assert.equal(page.style.visibility, undefined);
});

test("學生只有 token、沒有 student1_token 也算登入", () => {
  const page = loadGuard({ storage: { user_role: "student", token: "t1" } });
  assert.deepEqual(page.replaced, []);
});

test("學生只有 student1_token、沒有 token 也算登入", () => {
  const page = loadGuard({ storage: { user_role: "student", student1_token: "t1" } });
  assert.deepEqual(page.replaced, []);
});

test("讀 sessionStorage 丟例外（隱私模式）視同未登入", () => {
  const page = loadGuard({ storageThrows: true });
  assert.deepEqual(page.replaced, [HOME]);
});

test("Home 網址依 script 位置計算，跟頁面在哪一層無關", () => {
  const page = loadGuard({
    scriptSrc: "https://deploy.example/sub/dir/shared/require-student.js?v=3",
    pageHref: "https://deploy.example/sub/dir/tutorial/DAT_tutorial.html",
  });
  assert.deepEqual(page.replaced, ["https://deploy.example/sub/dir/Home/index.html"]);
});

test("取不到 currentScript 時改用頁面網址計算 Home", () => {
  const page = loadGuard({
    scriptSrc: null,
    pageHref: "https://webgames.test/DAT_single/DAT_single.html",
  });
  assert.deepEqual(page.replaced, [HOME]);
});

test("從 bfcache 還原時若已登出，會再導回 Home", () => {
  const page = loadGuard({ storage: { ...STUDENT_SINGLE } });
  assert.deepEqual(page.replaced, []);

  // 學生登出：Select 的登出按鈕會 sessionStorage.clear()
  for (const key of Object.keys(page.storage)) delete page.storage[key];
  page.firePageshow(true);

  assert.deepEqual(page.replaced, [HOME]);
  assert.equal(page.style.visibility, "hidden");
});

test("從 bfcache 還原時仍登入，不跳轉", () => {
  const page = loadGuard({ storage: { ...STUDENT_SINGLE } });
  page.firePageshow(true);
  assert.deepEqual(page.replaced, []);
});

test("一般載入的 pageshow（persisted=false）不重複導頁", () => {
  const page = loadGuard();
  assert.deepEqual(page.replaced, [HOME]);
  page.firePageshow(false);
  assert.deepEqual(page.replaced, [HOME]);
});
