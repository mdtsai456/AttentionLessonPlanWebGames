(function () {
  window.addEventListener('beforeunload', (event) => {
    if (!window.__askLeave) return;
    event.preventDefault();
    event.returnValue = '';
  });

  window.askLeave = function (url) {
    window.__askLeave = true;
    window.location.href = url;
  };
})();
