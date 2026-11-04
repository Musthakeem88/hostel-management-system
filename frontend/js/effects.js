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

  /* ---------- 5. a highlight that GLIDES to the page you open (dock, pill menu, phone tab bar) ---------- */
  function glide(container, itemSelector, className) {
    if (!container) return;
    let placed = false;

    function place() {
      let el = container.querySelector(":scope > ." + className);
      if (!el) {
        el = document.createElement("span");
        el.className = className;
        el.setAttribute("aria-hidden", "true");
        container.prepend(el);
        container.classList.add("has-glide");
        placed = false;
      }
      const active = container.querySelector(itemSelector + ".active");
      if (!active || active.offsetParent === null) { el.style.opacity = "0"; return; }
      if (!placed) el.style.transition = "none";            // first time: appear in place, do not fly in from the corner
      el.style.opacity = "1";
      el.style.width = active.offsetWidth + "px";
      el.style.height = active.offsetHeight + "px";
      el.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      if (!placed) { void el.offsetWidth; el.style.transition = ""; placed = true; }
    }

    new MutationObserver(place).observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", place);
    place();
  }
  glide(document.getElementById("nav"), "button", "glide");
  glide(document.getElementById("topnav"), ".navpill", "glide-pill");

  /* ---------- 6. the dock reacts to the cursor like a Mac dock: icons near the pointer swell ---------- */
  const dock = document.getElementById("nav");
  const wide = () => window.innerWidth > 860 && dock && getComputedStyle(dock).position === "fixed";

  function dockReset() {
    dock.querySelectorAll(":scope > button").forEach((b) => { b.style.removeProperty("--s"); b.style.removeProperty("--z"); });
  }
  if (dock && !calm) {
    dock.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || !wide()) return;
      dock.querySelectorAll(":scope > button").forEach((b) => {
        const r = b.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (r.top + r.height / 2));
        const k = Math.exp(-Math.pow(distance / 58, 2));          // 1 under the pointer, fading with distance
        b.style.setProperty("--s", (1 + 0.34 * k).toFixed(3));
        b.style.setProperty("--z", String(Math.round(k * 10)));
        const x = event.clientX - r.left, y = event.clientY - r.top;
        b.style.setProperty("--mx", `${x}px`); b.style.setProperty("--my", `${y}px`);
      });
    }, { passive: true });
    dock.addEventListener("pointerleave", dockReset);
  }

  /* ---------- 7. pills and round buttons lean toward the cursor (a gentle magnet) and glow under it ---------- */
  const MAGNETS = ".navpill, .icon-btn, .user-chip";
  if (!calm) {
    document.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const el = event.target.closest && event.target.closest(MAGNETS);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = event.clientX - (r.left + r.width / 2), dy = event.clientY - (r.top + r.height / 2);
      el.style.setProperty("--tx", `${(dx * 0.18).toFixed(1)}px`);
      el.style.setProperty("--ty", `${(dy * 0.22).toFixed(1)}px`);
      el.style.setProperty("--mx", `${event.clientX - r.left}px`);
      el.style.setProperty("--my", `${event.clientY - r.top}px`);
    }, { passive: true });
    document.addEventListener("pointerout", (event) => {
      const el = event.target.closest && event.target.closest(MAGNETS);
      if (el && !el.contains(event.relatedTarget)) { el.style.removeProperty("--tx"); el.style.removeProperty("--ty"); }
    });
  }
})();
