(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const decode = (image) => image.decode().then(() => true, () => false);

  // 只有仍對應目前題目的流程，才可替換或顯示圖片。
  async function prepareItems(images, timeoutMs, isCurrent, labelCard) {
    const decoded = new Set();
    const preparation = images.map(async (image) => {
      const source = image.src;
      if (await decode(image) && image.src === source) decoded.add(image);
    });
    await Promise.race([Promise.all(preparation), wait(timeoutMs)]);
    if (!isCurrent()) return false;
    const pending = images.filter((image) => !decoded.has(image));
    pending.forEach((image) => {
      image.onerror = null;
      image.src = labelCard(image.alt);
    });
    const fallbackReady = await Promise.all(pending.map(decode));
    return isCurrent() && fallbackReady.every(Boolean) && images.every((image) => image.complete && image.naturalWidth > 0);
  }

  function createViewportGuard({ minWidth, minHeight, landscape = false, onBlock, onResume, onLeave }) {
    const overlay = document.createElement("section");
    overlay.className = "tgame-pause";
    overlay.hidden = true;
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "遊戲暫停");
    overlay.innerHTML = '<div class="tgame-pause-card"><h1>遊戲已暫停</h1><p aria-live="polite"></p><div class="btn-row"><button class="btn btn-green" type="button">繼續</button><button class="btn btn-sky" type="button">離開</button></div></div>';
    document.body.appendChild(overlay);
    const message = overlay.querySelector("p");
    const [resume, leave] = overlay.querySelectorAll("button");
    let active = false;
    const isUsable = () => innerWidth >= minWidth && innerHeight >= minHeight && (!landscape || innerWidth >= innerHeight);
    function hide() {
      active = false;
      overlay.hidden = true;
      document.querySelector(".stage").inert = false;
    }
    function update() {
      const usable = isUsable();
      if (!usable && onBlock()) {
        const wasActive = active;
        active = true;
        overlay.hidden = false;
        document.querySelector(".stage").inert = true;
        if (!wasActive) overlay.focus({ preventScroll: true });
      }
      if (!active) return;
      resume.disabled = !usable;
      message.textContent = usable
        ? "畫面已恢復，按「繼續」恢復遊玩。分數與剩餘時間已保留。"
        : `請${landscape ? "將裝置轉為橫向，或" : ""}放大視窗後繼續。分數與剩餘時間已保留。`;
    }
    resume.addEventListener("click", async () => {
      if (!isUsable() || resume.disabled) return;
      resume.disabled = true;
      if (await onResume()) hide();
      else update();
    });
    leave.addEventListener("click", () => { leave.disabled = true;onLeave(); });
    window.addEventListener("resize", update);
    return { update, hide, isUsable };
  }

  window.TGameSupport = { prepareItems, createViewportGuard };
})();
