// 學生頁守門：沒有學生登入（含老師身分）就直接回 Home，不讓頁面跑起來。
// 必須放在 <head> 最前面同步載入，搶在其他 script 之前執行。
(function (global) {
  const scriptSrc = document.currentScript && document.currentScript.src;
  const loginPageHref = new URL(
    "../Home/index.html",
    scriptSrc || global.location.href
  ).href;

  function isStudentLoggedIn() {
    try {
      return (
        sessionStorage.getItem("user_role") === "student" &&
        Boolean(
          sessionStorage.getItem("student1_token") ||
            sessionStorage.getItem("token")
        )
      );
    } catch (err) {
      // 隱私模式下讀 sessionStorage 會 throw；當成未登入。
      return false;
    }
  }

  if (!isStudentLoggedIn()) {
    // 先藏起來，避免跳轉前閃一下頁面內容。
    document.documentElement.style.visibility = "hidden";
    global.location.replace(loginPageHref);
  }
})(window);
