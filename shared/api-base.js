// 後端 API 位址，全站只在這裡判斷。各頁在 <head> 最先同步載入，
// require-student.js、api.js、session-timeout.js 與 DCCS 都用 window.resolveApiBase()。
(function (global) {
  global.resolveApiBase = function () {
    // 覆寫網址結尾的斜線要去掉，否則接上 /sessions 會變成 //sessions。
    if (global.API_BASE_URL) return String(global.API_BASE_URL).replace(/\/+$/, "");
    if (global.location.pathname.startsWith("/app/")) return global.location.origin + "/api";
    const { hostname, protocol } = global.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") return `${protocol}//${hostname}:5001/api`;
    return "https://attention-lesson-plan-data.zeabur.app/api";
  };
})(window);
