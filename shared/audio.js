// 答對／答錯／過關提示音：用 Web Audio API 即時生成，不需外部音檔。
// 靜音偏好存在 localStorage（裝置層級的偏好，不是登入狀態），跨遊戲、跨登入都記得。
(function (global) {
  const MUTE_KEY = "webgame_audio_muted";
  let ctx = null;

  function getContext() {
    const AudioCtor = global.AudioContext || global.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!ctx) ctx = new AudioCtor();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function isMuted() {
    try {
      return global.localStorage.getItem(MUTE_KEY) === "1";
    } catch (_err) {
      return false;
    }
  }

  function setMuted(muted) {
    try {
      global.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch (_err) {
      // localStorage 被封鎖（例如隱私模式）時，靜音偏好當次有效即可。
    }
    updateButton();
  }

  /** 播放一串音符：[{freq, start, duration, type, gain}]，start/duration 單位是秒。 */
  function playTones(tones) {
    if (isMuted()) return;
    const audioCtx = getContext();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      tones.forEach(({ freq, start = 0, duration = 0.12, type = "sine", gain = 0.2 }) => {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gainNode.gain.setValueAtTime(gain, now + start);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      });
    } catch (_err) {
      // 瀏覽器不支援或被使用者手勢政策擋下時，安靜地不播放，不影響遊戲進行。
    }
  }

  function playCorrect() {
    playTones([
      { freq: 880, duration: 0.1 },
      { freq: 1320, start: 0.08, duration: 0.14 },
    ]);
  }

  function playWrong() {
    playTones([{ freq: 220, duration: 0.18, type: "square", gain: 0.15 }]);
  }

  function playComplete() {
    playTones([
      { freq: 660, start: 0, duration: 0.12 },
      { freq: 880, start: 0.12, duration: 0.12 },
      { freq: 1100, start: 0.24, duration: 0.24 },
    ]);
  }

  let button = null;

  function updateButton() {
    if (!button) return;
    const muted = isMuted();
    button.textContent = muted ? "🔇" : "🔊";
    button.setAttribute("aria-label", muted ? "目前靜音，點擊取消靜音" : "目前有聲音，點擊靜音");
  }

  function ensureButton() {
    if (button || !document.body) return;
    const style = document.createElement("style");
    style.id = "webgame-audio-style";
    style.textContent = `
.webgame-audio-toggle{position:fixed;right:.8rem;bottom:.8rem;z-index:2147483000;width:2.6rem;height:2.6rem;border-radius:50%;border:none;background:#ffffffcc;box-shadow:0 2px 8px rgba(0,0,0,.2);font-size:1.3rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
.webgame-audio-toggle:focus-visible{outline:3px solid #2b6cb0;outline-offset:2px}`;
    document.head.appendChild(style);
    button = document.createElement("button");
    button.type = "button";
    button.className = "webgame-audio-toggle";
    button.addEventListener("click", () => setMuted(!isMuted()));
    document.body.appendChild(button);
    updateButton();
  }

  if (document.body) ensureButton();
  else document.addEventListener("DOMContentLoaded", ensureButton, { once: true });

  global.WebGameAudio = { playCorrect, playWrong, playComplete, isMuted, setMuted };
})(window);
