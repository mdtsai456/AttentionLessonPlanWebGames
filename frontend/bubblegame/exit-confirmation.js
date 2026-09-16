const playScreen = document.getElementById("play-screen");
const resultOverlay = document.getElementById("result-overlay");
const leaveButton = document.getElementById("leave-game-button");

const isGameInProgress = () =>
  !playScreen.classList.contains("is-hidden") &&
  resultOverlay.classList.contains("is-hidden");

leaveButton.addEventListener("click", () => {
  if (window.confirm("中途離開會導致數據遺失，是否能要離開?")) {
    window.removeEventListener("beforeunload", confirmBrowserExit);
    window.location.href = "../games.html";
  }
});

function confirmBrowserExit(event) {
  if (!isGameInProgress()) return;

  event.preventDefault();
  event.returnValue = "";
}

window.addEventListener("beforeunload", confirmBrowserExit);
