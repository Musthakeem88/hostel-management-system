/* =========================================================
   js/core/utils.js  —  small helpers used by every page
========================================================= */

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

let toastTimer = null;

function toast(message, kind = "") {
  const box = $("#toast");
  box.textContent = message;
  box.dataset.kind = kind;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), kind === "error" ? 5200 : 3200);
}

const debounce = (fn, ms = 250) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

/* ---------- dates and money ---------- */

function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "2026-10-28" (plain date) -> "28 Oct 2026"
function fmtDate(value) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return esc(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function parseTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(" ", "T") + (/[zZ]|[+-]\d\d(:?\d\d)?$/.test(s) ? "" : "Z");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// timestamp -> "28 Oct 2026, 14:05"
function fmtTime(value) {
  const d = parseTime(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const money = (n) => `RM ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ago(value) {
  const d = parseTime(value);
  if (!d) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d.toISOString().slice(0, 10));
}

/* ---------- badges ---------- */

function tone(status) {
  const v = String(status ?? "").toLowerCase();
  if (["good", "paid", "completed", "resolved", "returned", "checked out", "claimed", "confirmed", "published", "active", "in use", "approved", "available"].includes(v)) return "good";
  if (["broken", "urgent", "rejected", "lost", "critical", "overdue", "late", "returned late", "disabled", "high", "under maintenance", "maintenance"].includes(v)) return "bad";
  if (["pending", "damaged", "reported", "under review", "under investigation", "waitlisted", "disputed", "partially paid", "unpaid", "open", "in review", "medium", "important", "full", "investigating", "under repair"].includes(v)) return "warn";
  return "info";
}

const badge = (text, forced) => `<span class="badge ${forced || tone(text)}">${esc(text ?? "—")}</span>`;

/* ---------- forms ---------- */

const options = (list, selected = "") =>
  list.map((o) => {
    const value = typeof o === "object" ? o.value : o;
    const label = typeof o === "object" ? o.label : o;
    return `<option value="${esc(value)}"${String(value) === String(selected) ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");

function formData(form) {
  const out = {};
  new FormData(form).forEach((value, key) => { out[key] = typeof value === "string" ? value.trim() : value; });
  return out;
}

async function submitting(form, work) {
  const buttons = $$('button[type="submit"]', form);
  buttons.forEach((b) => { b.disabled = true; });
  try {
    return await work();
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

/* ---------- table / details builders ---------- */

/* columns: [{ label, key?, render?(row), cls?, num? }]  — every cell gets data-label so phones can stack rows */
function tbl(columns, rows, { empty = "Nothing to show yet.", rowClass } = {}) {
  if (!rows.length) return `<div class="empty-card"><b>${esc(empty)}</b></div>`;

  const head = columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("");
  const body = rows.map((row) => `
    <tr${rowClass && rowClass(row) ? ` class="${rowClass(row)}"` : ""}>
      ${columns.map((c) => {
        const content = c.render ? c.render(row) : esc(row[c.key] ?? "—");
        return `<td data-label="${esc(c.label)}"${c.cls || c.num ? ` class="${[c.cls, c.num ? "num" : ""].join(" ").trim()}"` : ""}>${content}</td>`;
      }).join("")}
    </tr>`).join("");

  return `<div class="scroll"><table class="rtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function dl(pairs) {
  return `<dl class="details">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === undefined || v === null || v === "" ? "—" : v}</dd>`).join("")}</dl>`;
}

const section = (text) => `<h4 class="section-sub">${esc(text)}</h4>`;
const emptyCard = (title, hint = "") => `<div class="empty-card"><b>${esc(title)}</b>${esc(hint)}</div>`;

/* the small coloured icon on each stat tile: [icon, colour] picked from the label */
const STAT_LOOKS = [
  [/damage report|damaged|damage/i, "damage", "amber"], [/maintenance|pending|progress|completed|overdue|job/i, "maintenance", "amber"],
  [/repair/i, "repairs", "amber"], [/fine/i, "fines", "amber"], [/fee|invoice|payment|deposit|RM /i, "fees", "green"],
  [/student|resident/i, "students", "purple"], [/room application|application/i, "applications", "blue"],
  [/check-in|inspection/i, "inspections", "blue"], [/visitor/i, "visitors", "blue"], [/leave/i, "leaves", "purple"],
  [/transfer/i, "transfers", "purple"], [/complaint/i, "complaints", "amber"], [/incident/i, "incidents", "red"],
  [/item/i, "items", "blue"], [/notice/i, "notices", "blue"], [/key/i, "keys", "amber"], [/room|bed/i, "rooms", "blue"]
];

function statCard(label, value, { warn = false, page = null, hint = "" } = {}) {
  const [, ico, tone] = STAT_LOOKS.find(([re]) => re.test(label)) || [null, "dashboard", "blue"];
  const inner = `<i class="stat-ico t-${warn ? "red" : tone}">${icon(ico)}</i><b>${value}</b><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ""}`;
  return page
    ? `<button type="button" class="stat clickable${warn ? " warn" : ""}" data-goto="${page}">${inner}</button>`
    : `<div class="stat${warn ? " warn" : ""}">${inner}</div>`;
}

const roomLabel = (r) => r.room_id || `${r.room_block}-${String(r.room_floor).padStart(2, "0")}-${String(r.room_number).padStart(2, "0")}`;

function filterChips(name, list, current, counts) {
  return `<div class="filters">${list.map((v) => `
    <button type="button" data-action="chip" data-filter="${esc(name)}" data-value="${esc(v)}" class="${current === v ? "active" : ""}">${esc(v)}${counts ? ` (${counts[v] ?? 0})` : ""}</button>`).join("")}</div>`;
}

// a page's filters / tabs; missing keys always get their defaults (another page may have created the object first)
const ui = (page, defaults = {}) => {
  const current = state.ui[page] || (state.ui[page] = {});
  Object.keys(defaults).forEach((key) => { if (!(key in current)) current[key] = defaults[key]; });
  return current;
};

// highlight-free text search over several fields
const matches = (row, query, keys) => {
  if (!query) return true;
  const q = query.toLowerCase();
  return keys.some((k) => String(row[k] ?? "").toLowerCase().includes(q));
};
