/* js/pages/inspections.js  —  check-in / check-out inspections with photos and comparison */

let inspectionDraft = null;   // the checklist being filled in

pages.inspections = {
  async load() {
    const [inspections, rooms] = await Promise.all([api("/inspections"), api("/rooms")]);
    state.d.inspections = { inspections, rooms };
    inspectionDraft = null;
  },

  render() {
    const { inspections, rooms } = state.d.inspections;
    const f = ui("inspections", { filter: "All" });
    const filters = ["All", "Check-in", "Check-out", "Pending", "Disputed"];

    const list = inspections.filter((i) =>
      f.filter === "All" || i.inspection_type === f.filter || i.confirmation_status === f.filter);

    const canRecord = isRole("warden", "administrator");

    return `
      ${canRecord ? `
      <div class="card">
        <h3>Record an inspection</h3>
        <p class="muted">Walk through the room item by item. Take a photo of anything that is not in good condition — photos are the proof if there is a dispute later.</p>
        <form data-form="inspection-save" id="inspection-form">
          <div class="form">
            <label>Room *
              <select name="room" required data-change="inspection-room">${roomOptionsHtml(rooms.filter((r) => r.occupied > 0), { blank: "Select a room with residents" })}</select>
            </label>
            <label>Student *
              <select name="student" required><option value="">Choose the room first</option></select>
            </label>
            <label>Inspection type *
              <select name="type" required>${options(["Check-in", "Check-out"])}</select>
            </label>
          </div>
          <div id="insp-checklist"></div>
          <label>General notes <input name="notes" maxlength="500" placeholder="Anything else the next person should know"></label>
          <button class="btn" type="submit" id="insp-submit" disabled>Save inspection</button>
        </form>
      </div>` : ""}

      <div class="toolbar">
        ${filterChips("inspections.filter", filters, f.filter)}
      </div>

      <div class="card">
        ${tbl([
          { label: "Date", render: (i) => fmtTime(i.inspection_date) },
          { label: "Type", render: (i) => badge(i.inspection_type, "info") },
          { label: "Room", key: "room_id" },
          { label: "Student", key: "student_number" },
          { label: "Inspector", render: (i) => esc(i.inspector_name || "—") },
          { label: "Items", render: (i) => { const bad = i.items.filter((x) => x.condition !== "Good").length; return `${i.items.length}${bad ? ` · <span class="badge warn">${bad} not good</span>` : ""}`; } },
          { label: "Photos", render: (i) => i.items.reduce((n, x) => n + x.photos.length, 0) },
          { label: "Student confirmed", render: (i) => badge(i.confirmation_status) },
          { label: "", render: (i) => `<div class="row-actions"><button class="btn ghost small" data-action="view-inspection" data-id="${i.inspection_id}">View</button>${i.inspection_type === "Check-out" ? `<button class="btn small" data-action="compare-inspection" data-id="${i.inspection_id}">Compare</button>` : ""}</div>` }
        ], list, { empty: "No inspections recorded yet." })}
      </div>`;
  }
};

/* ---------- building the checklist ---------- */

changes["inspection-room"] = async (select) => {
  const box = $("#insp-checklist");
  const studentSelect = $('#inspection-form [name="student"]');
  const submit = $("#insp-submit");
  submit.disabled = true;

  if (!select.value) { box.innerHTML = ""; studentSelect.innerHTML = '<option value="">Choose the room first</option>'; return; }
  box.innerHTML = '<div class="skeleton"></div>';

  try {
    const d = await api(`/inspections/room-items?room_id=${encodeURIComponent(select.value)}`);
    inspectionDraft = d;
    Object.keys(photoState).filter((k) => k.startsWith("insp-")).forEach((k) => delete photoState[k]);

    studentSelect.innerHTML = d.residents.length === 1
      ? options(d.residents.map((r) => ({ value: r.student_number, label: `${r.full_name} (${r.student_number})` })), d.residents[0].student_number)
      : `<option value="">Select the student</option>${options(d.residents.map((r) => ({ value: r.student_number, label: `${r.full_name} (${r.student_number})` })))}`;

    const rows = [{ property_id: null, item: "Room overview (general photos)", item_code: null, overview: true }, ...d.items];
    box.innerHTML = `
      ${d.from_inventory ? "" : '<div class="notice">This room has no item list yet, so the standard items are shown. An administrator can add the room’s items on the Rooms page.</div>'}
      <div class="checklist">
        ${rows.map((r, idx) => `
          <div class="check-row" data-idx="${idx}" data-prop="${r.property_id ?? ""}" data-item="${esc(r.overview ? "Room overview" : r.item)}">
            <div class="name"><b>${esc(r.item)}</b><small>${esc(r.item_code || (r.overview ? "Take 1–3 photos of the whole room" : "No item code"))}</small></div>
            <div class="seg" role="radiogroup" aria-label="Condition of ${esc(r.item)}">
              ${CONDITIONS.map((c) => `<label><input type="radio" name="cond-${idx}" value="${c}" ${c === "Good" ? "checked" : ""} data-change="inspection-cond"><span>${c}</span></label>`).join("")}
            </div>
            <input type="text" name="note-${idx}" maxlength="300" placeholder="Note, e.g. large tear" aria-label="Note for ${esc(r.item)}">
            <div>${photoPicker(`insp-${idx}`, { max: 6, label: "Photo", compact: true })}</div>
          </div>`).join("")}
      </div>`;
    submit.disabled = d.residents.length === 0;
    if (!d.residents.length) toast("Nobody lives in this room.", "error");
  } catch (error) {
    box.innerHTML = "";
    toast(error.message, "error");
  }
};

changes["inspection-cond"] = (radio) => {
  const row = radio.closest(".check-row");
  row.classList.toggle("bad", radio.value !== "Good");
};

forms["inspection-save"] = async (form) => {
  if (!inspectionDraft) { toast("Choose a room first.", "error"); return; }
  if (photosBusy()) { toast("Photos are still uploading — please wait a moment.", "error"); return; }

  const v = formData(form);
  const rows = $$("#insp-checklist .check-row");
  const items = [];
  let total = 0;
  let problem = null;

  rows.forEach((row) => {
    const idx = row.dataset.idx;
    const cond = (form.querySelector(`input[name="cond-${idx}"]:checked`) || {}).value || "Good";
    const ids = photoIds(`insp-${idx}`);
    total += ids.length;
    if (cond !== "Good" && !ids.length && !problem) problem = { row, name: row.dataset.item };
    items.push({ property_id: row.dataset.prop ? Number(row.dataset.prop) : null, item: row.dataset.item, condition: cond, note: (form.elements[`note-${idx}`].value || "").trim(), photo_ids: ids });
  });

  if (problem) { problem.row.scrollIntoView({ block: "center", behavior: "smooth" }); toast(`Add a photo of the ${problem.name} — it is not in good condition.`, "error"); return; }
  if (v.type === "Check-in" && total === 0) { toast("A check-in needs photos of the room.", "error"); return; }

  await submitting(form, async () => {
    try {
      const result = await api("/inspections", { method: "POST", body: { room_id: v.room, student_number: v.student, inspection_type: v.type, general_notes: v.notes, inspection_items: items } });
      toast("Inspection saved.");
      Object.keys(photoState).filter((k) => k.startsWith("insp-")).forEach((k) => delete photoState[k]);
      await refresh();
      if (result.comparison) showComparison(result.comparison, result.inspection);
    } catch (error) { toast(error.message, "error"); }
  });
};

/* ---------- viewing one inspection ---------- */

async function viewInspection(id) {
  try {
    const i = await api(`/inspections/${id}`);
    const mine = isRole("student");
    openModal(`
      ${modalHead(`${i.inspection_type} inspection · room ${i.room_id}`)}
      ${dl([["Date", fmtTime(i.inspection_date)], ["Student", esc(i.student_number)], ["Inspector", esc(i.inspector_name || "—")],
            ["Student confirmation", badge(i.confirmation_status)], i.student_comment ? ["Student comment", esc(i.student_comment)] : null,
            i.general_notes ? ["Notes", esc(i.general_notes)] : null])}
      ${section("Items")}
      ${tbl([
        { label: "Item", render: (x) => `${esc(x.item)}${x.item_code ? ` <span class="muted mono">${esc(x.item_code)}</span>` : ""}` },
        { label: "Condition", render: (x) => badge(x.condition) },
        { label: "Note", render: (x) => esc(x.note || "—"), cls: "wrap" },
        { label: "Photos", render: (x) => (x.photos.length ? photoGallery(x.photos) : '<span class="muted">—</span>') }
      ], i.items)}
      <div class="modal-actions">
        ${mine && i.inspection_type === "Check-in" && i.confirmation_status === "Pending" ? `
          <button class="btn good" data-action="checkin-confirm" data-id="${i.inspection_id}">It is correct</button>
          <button class="btn ghost danger" data-action="checkin-dispute" data-id="${i.inspection_id}">Something is wrong</button>` : ""}
        ${i.inspection_type === "Check-out" ? `<button class="btn" data-action="compare-inspection" data-id="${i.inspection_id}">Compare with check-in</button>` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["view-inspection"] = (el) => viewInspection(el.dataset.id);

/* ---------- check-out against check-in ---------- */

function showComparison(c, inspection) {
  const staff = isRole("warden", "administrator");
  openModal(`
    ${modalHead("Check-out compared with check-in")}
    ${c.baseline_id ? "" : '<div class="notice">No earlier check-in was found for this student and room, so nothing could be compared.</div>'}
    ${c.baseline_id && !c.baseline_confirmed ? '<div class="notice">The student has not confirmed the check-in yet, so this comparison may be disputed.</div>' : ""}
    <div class="summary-chips"><span>Items checked <b>${c.rows.length}</b></span><span>New damage <b>${c.new_damage}</b></span></div>
    ${tbl([
      { label: "Item", render: (r) => `${esc(r.item)}${r.item_code ? ` <span class="muted mono">${esc(r.item_code)}</span>` : ""}` },
      { label: "At check-in", render: (r) => `${r.checkin_condition ? badge(r.checkin_condition) : "—"}${r.checkin_note ? `<div class="muted">${esc(r.checkin_note)}</div>` : ""}${photoGallery(r.checkin_photos)}` },
      { label: "At check-out", render: (r) => `${badge(r.checkout_condition)}${r.checkout_note ? `<div class="muted">${esc(r.checkout_note)}</div>` : ""}${photoGallery(r.checkout_photos)}` },
      { label: "Result", render: (r) => badge(r.result, r.result === "New damage" ? "bad" : r.result === "Improved" ? "good" : "info") },
      { label: "", render: (r) => (staff && r.result === "New damage" && can("damage")
          ? `<button class="btn small" data-action="damage-from-compare" data-item="${esc(r.item)}" data-prop="${r.property_id ?? ""}" data-note="${esc(r.checkout_note)}" data-room="${esc(inspection ? inspection.room_id : "")}" data-student="${esc(inspection ? inspection.student_number : "")}" data-inspection="${inspection ? inspection.inspection_id : ""}">Report damage</button>` : "") }
    ], c.rows, { rowClass: (r) => (r.result === "New damage" ? "diff-new" : r.result === "Improved" ? "diff-better" : "") })}
    <div class="modal-actions"><button class="btn ghost" data-action="close-modal">Close</button></div>`, { wide: true });
}

actions["compare-inspection"] = async (el) => {
  try {
    const [c, i] = await Promise.all([api(`/inspections/${el.dataset.id}/compare`), api(`/inspections/${el.dataset.id}`)]);
    showComparison(c, i);
  } catch (error) { toast(error.message, "error"); }
};

// jump to the damage form with the new damage already filled in
actions["damage-from-compare"] = async (el) => {
  ui("damage").prefill = { room_id: el.dataset.room, student_number: el.dataset.student, item: el.dataset.item, property_id: el.dataset.prop, inspection_id: el.dataset.inspection, description: el.dataset.note ? `${el.dataset.item}: ${el.dataset.note}` : `${el.dataset.item} found damaged at check-out` };
  closeModal("modal");
  await go("damage");
};
