/* =========================================================
   js/effects.js  —  small touches that CSS cannot do alone
   1. cursor light on glass cards   2. numbers that count up
   3. button ripples                4. light/dark cross-fade
   Nothing here changes what the app does; it only decorates.
========================================================= */
(function () {
  "use strict";

  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 1. the light on a glass card follows the pointer ---------- */
  let frame = 0;
  document.addEventListener("pointermove", (event) => {
    const card = event.target.closest && event.target.closest(".stat, .card");
    if (!card || frame) return;
    frame = requestAnimationFrame(() => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - r.left}px`);
      card.style.setProperty("--my", `${event.clientY - r.top}px`);
      frame = 0;
    });
  }, { passive: true });

  /* ---------- 2. stat numbers count up when a page opens ---------- */
  const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  function countUp(el) {
    if (calm || el.dataset.counted) return;
    const final = el.textContent;
    if (!NUMBER.test(final)) return;
    NUMBER.lastIndex = 0;
    el.dataset.counted = "1";

    const parts = [];
    let last = 0, m;
    while ((m = NUMBER.exec(final))) {
      const decimals = (m[0].split(".")[1] || "").length;
      parts.push({ text: final.slice(last, m.index), value: parseFloat(m[0].replace(/,/g, "")), decimals, comma: m[0].includes(",") });
      last = m.index + m[0].length;
    }
    const tail = final.slice(last);
    const start = performance.now(), length = 1100;

    function step(now) {
      const t = Math.min(1, (now - start) / length);
      const k = ease(t);
      el.textContent = parts.map((p) => p.text + (p.value * k).toLocaleString("en-US", {
        minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals, useGrouping: p.comma || p.value >= 10000
      })).join("") + tail;
      if (t < 1) requestAnimationFrame(step); else el.textContent = final;
    }
    requestAnimationFrame(step);
  }

  const view = document.getElementById("view");
  if (view && "MutationObserver" in window) {
    new MutationObserver(() => {
      view.querySelectorAll(".stat b:not([data-counted])").forEach(countUp);
    }).observe(view, { childList: true, subtree: true });
  }

  /* ---------- 3. ripple under the finger on buttons ---------- */
  document.addEventListener("pointerdown", (event) => {
    if (calm) return;
    const button = event.target.closest && event.target.closest("button.btn, .navpill, .icon-btn");
    if (!button || button.disabled) return;
    const r = button.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - r.left - size / 2}px;top:${event.clientY - r.top - size / 2}px`;
    button.appendChild(dot);
    dot.addEventListener("animationend", () => dot.remove());
  });

  /* ---------- 4. light/dark: let the colours fade for a moment ---------- */
  ["theme-toggle", "login-theme"].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("click", () => {
      const root = document.documentElement;
      root.classList.add("theme-fade");
      setTimeout(() => root.classList.remove("theme-fade"), 650);
    });
  });
})();
