/* =========================================================
   js/core/app.js  —  start-up, menu, page switching, search, notifications, events
========================================================= */

let current = null;
let pollTimer = null;

/* ---------- menu ---------- */

function buildNav() {
  const allowed = state.user.pages;
  const primary = PRIMARY[state.user.role] || [];
  const expanded = document.documentElement.dataset.nav === "expanded";
  let html = `<button type="button" class="nav-toggle" data-action="nav-toggle" aria-expanded="${expanded}" aria-label="${expanded ? "Collapse menu" : "Expand menu"}" data-tip="${expanded ? "Collapse menu" : "Expand menu"}">
    <svg class="ic-expand" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chevronsRight}</svg><svg class="ic-collapse" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chevronsLeft}</svg>
    <span class="label"><span class="long">Collapse menu</span></span>
  </button>`;

  GROUPS.forEach((group) => {
    const keys = Object.keys(PAGE_META).filter((k) => PAGE_META[k].group === group && allowed.includes(k));
    if (!keys.length) return;
    html += `<div class="nav-group">${esc(group)}</div>`;
    keys.forEach((key) => {
      const m = PAGE_META[key];
      const order = primary.indexOf(key);
      html += `<button type="button" data-view="${key}" data-tip="${esc(m.title)}" aria-label="${esc(m.title)}"${order >= 0 ? ` class="primary" style="--o:${order}"` : ""}>
        ${icon(m.icon)}
        <span class="label"><span class="long">${esc(m.title)}</span><span class="short">${esc(m.short)}</span></span>
        ${key === "notifications" ? '<span class="count" id="nav-count" hidden>0</span>' : ""}
      </button>`;
    });
  });

  html += `<button type="button" id="more-btn" data-action="more" aria-label="More pages">${icon("more")}<span class="label"><span class="short">More</span></span></button>`;
  $("#nav").innerHTML = html;

  // the pill menu at the top centre: the person's main pages
  $("#topnav").innerHTML = primary.filter((k) => allowed.includes(k)).map((key) =>
    `<button type="button" class="navpill" data-view="${key}">${icon(PAGE_META[key].icon)}<span>${esc(PAGE_META[key].short)}</span></button>`).join("");
  setActiveNav();
}

function setActiveNav() {
  $$("#nav button[data-view], #topnav button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === current));

  // on a phone only four pages have a tab: when you are on any other page, "More" is the lit tab
  const more = $("#more-btn");
  if (more) {
    const primary = PRIMARY[state.user && state.user.role] || [];
    more.classList.toggle("active", Boolean(current) && !primary.includes(current));
  }
  keepActiveNavVisible();
}

/* the page you opened must stay in view inside the menu, even if the menu itself was scrolled */
function keepActiveNavVisible(smooth = true) {
  const nav = $("#nav");
  const active = nav && [...nav.querySelectorAll("button.active")].find((b) => b.offsetParent !== null);
  if (!active || nav.scrollHeight <= nav.clientHeight + 1) return;

  const toggle = nav.querySelector(".nav-toggle");
  const top = active.offsetTop - (toggle ? toggle.offsetHeight + 16 : 12);   // leave room for the sticky toggle
  const bottom = active.offsetTop + active.offsetHeight + 12;
  const behavior = smooth && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ? "smooth" : "auto";

  if (top < nav.scrollTop) nav.scrollTo({ top: Math.max(0, top), behavior });
  else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTo({ top: bottom - nav.clientHeight, behavior });
}

/* desktop: expand the menu to show page names, or shrink it back to icons (remembered) */
actions["nav-toggle"] = () => {
  const root = document.documentElement;
  const expanded = root.dataset.nav !== "expanded";
  root.dataset.nav = expanded ? "expanded" : "collapsed";
  try { localStorage.setItem("hostel-nav", root.dataset.nav); } catch { /* storage blocked */ }

  const button = $(".nav-toggle");
  if (button) {
    const label = expanded ? "Collapse menu" : "Expand menu";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
  }
  $("#dock-tip").hidden = true;
  $$("#nav > button").forEach((b) => { b.style.removeProperty("--s"); b.style.removeProperty("--z"); });   // forget the icon swell
  setTimeout(() => keepActiveNavVisible(false), 320);
};

actions.more = () => {
  const allowed = state.user.pages;
  const body = GROUPS.map((group) => {
    const keys = Object.keys(PAGE_META).filter((k) => PAGE_META[k].group === group && allowed.includes(k));
    if (!keys.length) return "";
    return `<div><h4>${esc(group)}</h4><div class="sheet-grid">${keys.map((k) =>
      `<button type="button" data-goto="${k}" class="${k === current ? "active" : ""}">${icon(PAGE_META[k].icon)}${esc(PAGE_META[k].title)}</button>`).join("")}</div></div>`;
  }).join("");
  openModal(`${modalHead("All pages")}<div class="sheet">${body}</div>`);
};

/* ---------- showing a page ---------- */

const skeleton = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';

async function show(key, { quiet = false } = {}) {
  const page = pages[key];
  if (!page) return;

  current = key;
  setActiveNav();
  $("#title").textContent = typeof page.title === "function" ? page.title() : PAGE_META[key].title;
  $("#subtitle").textContent = PAGE_SUB[key] || "";

  if (!quiet) {
    // 1. the old page lets go: it fades and drifts up for a moment
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (view.children.length && !calm && !view.querySelector(".skeleton")) {
      view.classList.add("leaving");
      await new Promise((resolve) => setTimeout(resolve, 190));
      view.classList.remove("leaving");
      if (current !== key) return;                // the person already moved on to another page
    }
    // 2. the new page arrives (entrance animation plays only when the page really changes)
    const head = $(".page-head");
    head.classList.remove("swap"); void head.offsetWidth; head.classList.add("swap");
    view.classList.add("entering");
    clearTimeout(show.enterTimer);
    show.enterTimer = setTimeout(() => view.classList.remove("entering"), 1400);
  }
  document.title = `${PAGE_META[key].title} · Hostel Management`;
  if (!quiet) view.innerHTML = skeleton;

  try {
    if (page.load) await page.load();
  } catch (error) {
    if (error.status === 401) return;
    if (current !== key) return;
    view.innerHTML = `<div class="card"><div class="empty-card"><b>This page could not be loaded</b>${esc(error.message)}
      <div class="row-actions" style="justify-content:center;margin-top:12px"><button class="btn" data-action="reload">Try again</button></div></div></div>`;
    return;
  }

  if (current !== key) return;                     // the person moved on while loading
  paint();
}

function paint() {
  const page = pages[current];
  if (!page) return;
  const y = window.scrollY;
  view.innerHTML = page.render();
  if (page.ready) page.ready();
  window.scrollTo(0, y);
  centerActiveChips();
}

/* filter chips scroll sideways on a phone: keep the chosen one in the middle of the strip */
function centerActiveChips() {
  $$(".filters, .tabs").forEach((strip) => {
    const on = strip.querySelector("button.active");
    if (on && strip.scrollWidth > strip.clientWidth + 1) strip.scrollLeft = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
  });
}

const rerender = () => paint();

async function refresh() {
  const page = pages[current];
  if (!page) return;
  if (page.load) { try { await page.load(); } catch (error) { if (error.status !== 401) toast(error.message, "error"); return; } }
  paint();
}

async function go(key, { replace = false } = {}) {
  if (!state.user) return;
  if (!state.user.pages.includes(key)) key = "dashboard";
  closeModal("modal");
  const target = `#/${key}`;

  if (location.hash === target && current === key) { await show(key); return; }
  if (replace) history.replaceState(null, "", target); else location.hash = target;
  if (current !== key) await show(key);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => {
  if (!state.user) return;
  const key = location.hash.replace(/^#\//, "") || "dashboard";
  if (key !== current) show(state.user.pages.includes(key) ? key : "dashboard");
});

actions.reload = () => show(current);

/* ---------- notifications bell ---------- */

function setUnread(n) {
  state.unread = n;
  const bell = $("#bell-count");
  bell.textContent = n > 99 ? "99+" : n;
  bell.hidden = n === 0;
  const navCount = $("#nav-count");
  if (navCount) { navCount.textContent = n > 99 ? "99+" : n; navCount.hidden = n === 0; }
}

async function pollUnread() {
  try {
    const { unread } = await api("/notifications/count");
    if (unread > state.unread && state.unread !== null && current !== "notifications") toast("You have a new notification.");
    setUnread(unread);
  } catch { /* offline: try again next time */ }
}

function startPolling() { stopPolling(); pollTimer = setInterval(pollUnread, 60000); }
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

/* ---------- global search ---------- */

const SEARCH_ROLES = ["warden", "administrator", "management", "maintenance", "security"];
const OPEN_ENTITY = { student: "openStudent", room: "openRoom", item: "openItem", damage: "openDamage", repair: "openRepair", fine: "openFine" };

const runSearch = debounce(async () => {
  const input = $("#search");
  const box = $("#search-results");
  const q = input.value.trim();
  if (q.length < 2) { box.hidden = true; return; }

  try {
    const { groups } = await api(`/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = groups.length
      ? groups.map((g) => `<h4>${esc(g.title)}</h4>${g.results.map((r) =>
          `<button type="button" data-open="${g.type}" data-key="${esc(r.key)}" data-page="${g.page}">${esc(r.label)}<small>${esc(r.sub)}</small></button>`).join("")}`).join("")
      : `<p class="muted" style="padding:10px">Nothing found for “${esc(q)}”.</p>`;
    box.hidden = false;
  } catch (error) {
    box.innerHTML = `<p class="muted" style="padding:10px">${esc(error.message)}</p>`;
    box.hidden = false;
  }
}, 300);

async function openEntity(type, key, page) {
  $("#search-results").hidden = true;
  $("#search").value = "";
  await go(page);
  const fn = window[OPEN_ENTITY[type]];
  if (typeof fn === "function") fn(key);
}

/* ---------- start the session ---------- */

async function bootApp() {
  const me = await api("/auth/me");
  state.user = me.user;
  state.meta = null;
  state.d = {};
  state.ui = {};

  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#user-name").textContent = state.user.name;
  $("#avatar").textContent = (state.user.name || "?").trim().charAt(0).toUpperCase();
  $("#user-menu").title = state.user.name;
  $("#search-form").hidden = !SEARCH_ROLES.includes(state.user.role);
  buildNav();
  setUnread(me.unread || 0);

  if (state.user.mustChangePassword) {
    await changePasswordFlow({ forced: true });
    state.user.mustChangePassword = false;
  }

  state.meta = await api("/meta");
  startPolling();

  const wanted = location.hash.replace(/^#\//, "");
  const key = state.user.pages.includes(wanted) ? wanted : "dashboard";
  history.replaceState(null, "", `#/${key}`);
  await show(key);
}

/* ---------- one place for every click, submit and change ---------- */

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const tab = target.closest("[data-auth-tab]");
  if (tab) { switchAuthTab(tab.dataset.authTab); return; }

  const goto = target.closest("[data-goto]");
  if (goto) { event.preventDefault(); closeModal("modal2"); go(goto.dataset.goto); return; }

  const nav = target.closest("#nav button[data-view], #topnav button[data-view]");
  if (nav) { go(nav.dataset.view); return; }

  const open = target.closest("[data-open]");
  if (open) { openEntity(open.dataset.open, open.dataset.key, open.dataset.page); return; }

  const act = target.closest("[data-action]");
  if (act && actions[act.dataset.action]) { actions[act.dataset.action](act, event); return; }

  if (target.closest("#bell")) { go("notifications"); return; }
  if (target.closest("#user-menu")) { actions["user-menu"](); return; }

  if (!target.closest("#search-form")) $("#search-results").hidden = true;
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "search-form") { event.preventDefault(); const first = $("#search-results button"); if (first) first.click(); return; }
  const handler = form.dataset.form && forms[form.dataset.form];
  if (handler) { event.preventDefault(); handler(form, event); }
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (!(el instanceof Element)) return;
  const name = el.dataset.change;
  if (name && changes[name]) changes[name](el, event);
});

document.addEventListener("input", (event) => {
  if (event.target && event.target.id === "search") runSearch();
  const el = event.target;
  if (el instanceof Element && el.dataset.input && changes[el.dataset.input]) changes[el.dataset.input](el, event);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#search-results").hidden = true;
});

/* ---------- go ---------- */

(async function start() {
  if (!getToken()) { showLogin(); return; }
  try {
    await bootApp();
  } catch (error) {
    if (error.status !== 401) toast(error.message, "error");
    clearToken();
    showLogin();
  }
})();


/* ---------- icon dock: the name of a page appears beside its icon (hover, or keyboard focus) ---------- */
(function dockTips() {
  const tip = document.getElementById("dock-tip");
  const nav = document.getElementById("nav");
  if (!tip || !nav) return;

  function show(button) {
    if (!button || !button.dataset.tip || getComputedStyle(nav).position !== "fixed" || window.innerWidth <= 860) return;
    if (document.documentElement.dataset.nav === "expanded") return;   // page names are already visible
    const r = button.getBoundingClientRect();
    tip.textContent = button.dataset.tip;
    tip.hidden = false;
    tip.style.top = `${r.top + r.height / 2}px`;
    tip.style.left = `${r.right + 12}px`;
  }
  const hide = () => { tip.hidden = true; };

  nav.addEventListener("mouseover", (e) => show(e.target.closest("button")));
  nav.addEventListener("focusin", (e) => show(e.target.closest("button")));
  nav.addEventListener("mouseleave", hide);
  nav.addEventListener("focusout", hide);
  nav.addEventListener("scroll", hide);
})();
