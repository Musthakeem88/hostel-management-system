/* js/pages/modules.js  —  one generic page for visitors, leave, transfers, complaints, notices,
   keys, incidents, and lost & found. Each page is drawn from the definition the server sends
   (GET /api/meta), so the buttons always match what the person is allowed to do. */

const MODULE_KEYS = ["visitors", "leaves", "transfers", "complaints", "notices", "keys", "incidents", "lostfound"];

const moduleSpec = (key) => (state.meta && state.meta.modules[key]) || null;

function modulePage(key) {
  return {
    title: () => PAGE_META[key].title,

    async load() {
      const spec = moduleSpec(key);
      const d = { rows: await api(`/m/${key}`), rooms: [], hostels: [] };
      const needsRooms = spec.fields.some((f) => f.type === "room") || spec.actions.some((a) => (a.inputs || []).some((i) => i.type === "room"));
      const needsBlocks = spec.fields.some((f) => f.type === "block");
      if (needsRooms) d.rooms = await api("/rooms").catch(() => []);
      if (needsBlocks) d.hostels = await api("/hostels").catch(() => []);
      state.d[`m-${key}`] = d;
    },

    render() {
      const spec = moduleSpec(key);
      const d = state.d[`m-${key}`];
      const f = ui(`m-${key}`, { status: "All" });
      const statuses = spec.statusField ? ["All", ...Array.from(new Set(d.rows.map((r) => r[spec.statusField]).filter(Boolean)))] : [];
      const counts = { All: d.rows.length };
      statuses.slice(1).forEach((s) => { counts[s] = d.rows.filter((r) => r[spec.statusField] === s).length; });
      const rows = d.rows.filter((r) => f.status === "All" || r[spec.statusField] === f.status);

      return `
        <p class="muted">${esc(spec.summary || "")}</p>
        ${spec.canCreate ? moduleForm(key, spec, d) : ""}
        ${statuses.length > 2 ? `<div class="toolbar">${filterChips(`m-${key}.status`, statuses, f.status, counts)}</div>` : ""}
        <div class="card">
          ${tbl([
            ...spec.columns.filter((c) => !c.hidden).map((c) => ({ label: c.label, render: (r) => moduleCell(c, r), cls: ["body", "description", "message", "reason"].includes(c.name) ? "wrap" : "" })),
            { label: "Actions", render: (r) => moduleButtons(key, spec, r) }
          ], rows, { empty: "Nothing here yet." })}
        </div>`;
    }
  };
}

MODULE_KEYS.forEach((key) => { pages[key] = modulePage(key); });

function moduleCell(c, r) {
  const v = r[c.name];
  if (v === null || v === undefined || v === "") return "—";
  if (c.type === "date") return fmtDate(v);
  if (c.type === "time") return fmtTime(v);
  if (c.type === "badge") return badge(v);
  if (c.type === "number") return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return esc(v);
}

function moduleButtons(key, spec, r) {
  const parts = [];
  spec.actions.filter((a) => a.from.includes(r[spec.statusField])).forEach((a) => {
    parts.push(`<button class="btn small${a.tone === "bad" ? " ghost danger" : a.tone === "good" ? "" : " ghost"}" data-action="module-action" data-key="${key}" data-id="${r[Object.keys(r)[0]]}" data-act="${a.key}">${esc(a.label)}</button>`);
  });
  if (spec.canEdit) parts.push(`<button class="btn ghost small" data-action="module-edit" data-key="${key}" data-id="${r[Object.keys(r)[0]]}">Edit</button>`);
  return parts.length ? `<div class="row-actions">${parts.join("")}</div>` : '<span class="muted">—</span>';
}

/* ---------- the "add" form ---------- */

function moduleField(f, d, spec) {
  const id = `mf-${f.name}`;
  const req = f.required ? " required" : "";
  const label = `${esc(f.label)}${f.required ? " *" : ""}`;

  switch (f.type) {
    case "student":
      if (spec.scoped) return "";                                 // students always act for themselves
      return `<label>${label}<input name="${f.name}" id="${id}"${req} list="student-lookup" maxlength="30" autocomplete="off" data-input="student-lookup" placeholder="Type a name or number"></label>`;
    case "room":
      return `<label>${label}<select name="${f.name}"${req}>${roomOptionsHtml(d.rooms, { blank: f.required ? "Select room" : "No room" })}</select></label>`;
    case "block":
      return `<label>${label}<select name="${f.name}"${req}><option value="">${f.required ? "Select hostel" : "Any"}</option>${options(d.hostels.map((h) => ({ value: h.block, label: h.name })))}</select></label>`;
    case "select":
      return `<label>${label}<select name="${f.name}"${req}>${f.required ? "" : '<option value="">—</option>'}${options(f.options.filter((o) => !(spec.scoped && o === "Late arrival")), f.default || "")}</select></label>`;
    case "textarea":
      return `<label>${label}<textarea name="${f.name}"${req}${f.max ? ` maxlength="${f.max}"` : ""}></textarea></label>`;
    case "date":
      return `<label>${label}<input type="date" name="${f.name}"${req} value="${f.default === "today" ? todayISO() : ""}"></label>`;
    case "number":
      return `<label>${label}<input type="number" name="${f.name}"${req} min="0" step="0.01" inputmode="decimal"></label>`;
    default:
      return `<label>${label}<input name="${f.name}"${req}${f.max ? ` maxlength="${f.max}"` : ""}${f.pattern ? ` pattern="${esc(f.pattern)}"` : ""}></label>`;
  }
}

function moduleForm(key, spec, d) {
  const short = spec.fields.filter((f) => f.type !== "textarea");
  const long = spec.fields.filter((f) => f.type === "textarea");
  return `
    <div class="card">
      <h3>Add new</h3>
      <form data-form="module-create" data-key="${key}">
        <div class="form">${short.map((f) => moduleField(f, d, spec)).join("")}</div>
        ${long.map((f) => moduleField(f, d, spec)).join("")}
        <datalist id="student-lookup"></datalist>
        <button class="btn" type="submit" style="margin-top:14px">Save</button>
      </form>
    </div>`;
}

// suggestions while typing a student's name or number
changes["student-lookup"] = debounce(async (input) => {
  const q = input.value.trim();
  if (q.length < 2) return;
  try {
    const list = await api(`/students/lookup?q=${encodeURIComponent(q)}`);
    $("#student-lookup").innerHTML = list.map((s) => `<option value="${esc(s.student_number)}">${esc(s.full_name)} · room ${esc(s.room_id)}</option>`).join("");
  } catch { /* the suggestions are optional */ }
}, 250);

forms["module-create"] = async (form) => {
  const key = form.dataset.key;
  const spec = moduleSpec(key);
  const body = {};
  spec.fields.forEach((f) => { const el = form.elements[f.name]; if (el) body[f.name] = typeof el.value === "string" ? el.value.trim() : el.value; });

  await submitting(form, async () => {
    const ok = await attempt(() => api(`/m/${key}`, { method: "POST", body }), { success: "Saved." });
    if (ok) form.reset();
  });
};

/* ---------- buttons on a row ---------- */

function actionFields(inputs, d) {
  return inputs.map((i) => (i.type === "room"
    ? { name: i.name, label: i.label, type: "select", required: i.required, options: d.rooms.filter((r) => !r.under_maintenance && r.occupied < r.capacity).map((r) => ({ value: r.room_id, label: `${r.room_id} — ${r.capacity - r.occupied} free` })), blank: "Select a room with space" }
    : { name: i.name, label: i.label, type: i.type === "textarea" ? "textarea" : "text", required: i.required, maxlength: i.max }));
}

actions["module-action"] = async (el) => {
  const { key, id, act } = el.dataset;
  const spec = moduleSpec(key);
  const action = spec.actions.find((a) => a.key === act);
  const d = state.d[`m-${key}`];
  let body = {};

  if (action.inputs && action.inputs.length) {
    const v = await formModal({ title: action.label, fields: actionFields(action.inputs, d), submitText: action.label, danger: action.tone === "bad" });
    if (!v) return;
    body = v;
  } else if (action.confirm && !(await confirmDialog(action.confirm, { confirmText: action.label, danger: action.tone === "bad" }))) {
    return;
  }

  await attempt(() => api(`/m/${key}/${id}/${act}`, { method: "POST", body }), { success: `${action.label}: done.` });
};

actions["module-edit"] = async (el) => {
  const { key, id } = el.dataset;
  const spec = moduleSpec(key);
  const row = state.d[`m-${key}`].rows.find((r) => String(r[Object.keys(r)[0]]) === id);
  const fields = spec.fields.filter((f) => f.editable).map((f) => ({
    name: f.name, label: f.label, required: f.required, maxlength: f.max, value: row[f.name],
    type: f.type === "select" ? "select" : f.type === "textarea" ? "textarea" : f.type === "date" ? "date" : "text", options: f.options
  }));
  const v = await formModal({ title: "Edit", fields });
  if (v) attempt(() => api(`/m/${key}/${id}`, { method: "PUT", body: v }), { success: "Updated." });
};
