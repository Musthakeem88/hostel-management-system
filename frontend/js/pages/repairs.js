/* js/pages/repairs.js  —  repair requests: students report, wardens assign, technicians finish */

pages.repairs = {
  async load() {
    const d = { repairs: await api("/repairs"), staff: [], rooms: [], myRoom: null };

    if (isRole("warden", "administrator")) {
      [d.staff, d.rooms] = await Promise.all([api("/users/directory?role=maintenance"), api("/rooms")]);
    }
    if (isRole("student")) d.myRoom = await api("/profile/room");
    state.d.repairs = d;
  },

  render() {
    const { repairs, rooms, myRoom } = state.d.repairs;
    const f = ui("repairs", { status: "All", q: "" });
    const counts = { All: repairs.length };
    REPAIR_FLOW.forEach((s) => { counts[s] = repairs.filter((r) => r.repair_status === s).length; });
    const list = repairs.filter((r) => (f.status === "All" || r.repair_status === f.status) && matches(r, f.q, ["request_number", "item_name", "description", "room_id", "assigned_name"]));

    const canReport = isRole("student", "warden", "administrator");
    const itemNames = isRole("student") ? (myRoom ? myRoom.items.map((i) => i.item_name) : []) : DEFAULT_ITEMS;

    return `
      ${canReport ? `
      <div class="card">
        <h3>${isRole("student") ? "Report a problem in my room" : "Create a repair request"}</h3>
        ${isRole("student") && (!myRoom || !myRoom.room) ? '<div class="notice">You need a hostel room before you can report a problem.</div>' : `
        <form data-form="repair-save">
          <div class="form">
            ${isRole("student")
              ? `<label>Room<input value="${esc(myRoom.room.room_id)}" disabled></label>`
              : `<label>Room *<select name="room" required>${roomOptionsHtml(rooms, { blank: "Select room" })}</select></label>`}
            <label>Item *<input name="item_name" required maxlength="80" list="repair-items" placeholder="e.g. Ceiling fan"></label>
            <label>Priority<select name="priority">${options(PRIORITIES, "Normal")}</select></label>
          </div>
          <datalist id="repair-items">${Array.from(new Set(itemNames)).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
          <label>What is wrong? *<textarea name="description" required maxlength="1000"></textarea></label>
          <div><b>Photos (optional)</b>${photoPicker("repair-new", { max: 6, label: "Add photos", hint: "A photo helps the technician bring the right parts." })}</div>
          <button class="btn" type="submit" style="margin-top:14px">Send request</button>
        </form>`}
      </div>` : ""}

      <div class="toolbar">
        ${filterChips("repairs.status", ["All", ...REPAIR_FLOW], f.status, counts)}
        <input class="grow" type="search" placeholder="Search repairs…" value="${esc(f.q)}" data-input="filter" data-filter="repairs.q" aria-label="Search repairs">
        ${can("reports") && !isRole("warden") ? '<button class="btn ghost" data-action="export" data-report="repairs" data-format="xlsx">Export</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Request", render: (r) => `<button class="link mono" data-action="repair-open" data-id="${r.repair_id}">${esc(r.request_number)}</button>` },
          { label: "Reported", render: (r) => fmtDate(String(r.created_at).slice(0, 10)) },
          { label: "Room", key: "room_id" },
          { label: "Item", key: "item_name" },
          { label: "Problem", key: "description", cls: "wrap" },
          { label: "Priority", render: (r) => badge(r.priority) },
          { label: "Status", render: (r) => badge(r.repair_status) },
          { label: "Assigned to", render: (r) => esc(r.assigned_name || "—") },
          { label: "Time (h)", render: (r) => (r.hours_taken === null || r.hours_taken === undefined ? "—" : r.hours_taken), num: true },
          { label: "Cost", render: (r) => money(r.repair_cost), num: true },
          { label: "", render: (r) => repairButtons(r) }
        ], list, { empty: isRole("student") ? "You have not reported any problems." : "No repair requests found." })}
      </div>`;
  }
};

function repairButtons(r) {
  const done = r.repair_status === "Completed";
  const parts = [`<button class="btn ghost small" data-action="repair-open" data-id="${r.repair_id}">View</button>`];

  if (isRole("warden", "administrator") && !done) {
    parts.push(`<button class="btn ghost small" data-action="repair-assign" data-id="${r.repair_id}">Assign</button>`);
    parts.push(`<button class="btn small" data-action="repair-update" data-id="${r.repair_id}">Update</button>`);
  }
  if (isRole("maintenance") && !done) parts.push(`<button class="btn small" data-action="repair-update" data-id="${r.repair_id}">Update</button>`);
  if (done) parts.push('<span class="badge good">Locked</span>');
  return `<div class="row-actions">${parts.join("")}</div>`;
}

forms["repair-save"] = async (form) => {
  if (photosBusy("repair-new")) { toast("Photos are still uploading — please wait a moment.", "error"); return; }
  const v = formData(form);
  const body = { item_name: v.item_name, description: v.description, priority: v.priority, photo_ids: photoIds("repair-new") };

  if (!isRole("student")) {
    const parts = String(v.room || "").split("-");
    if (parts.length < 3) { toast("Select a room.", "error"); return; }
    Object.assign(body, { room_id: v.room, room_block: parts.slice(0, -2).join("-"), room_floor: Number(parts.at(-2)), room_number: Number(parts.at(-1)) });
  }

  await submitting(form, async () => {
    const ok = await attempt(() => api("/repairs", { method: "POST", body }));
    if (ok) { delete photoState["repair-new"]; }
  });
};

async function openRepair(id) {
  try {
    const d = await api(`/repairs/${id}`);
    const r = d.repair;
    openModal(`
      ${modalHead(`Repair ${r.request_number}`)}
      ${dl([
        ["Status", badge(r.repair_status)], ["Priority", badge(r.priority)], ["Room", esc(r.room_id)], ["Item", esc(r.item_name)],
        ["Reported", fmtTime(r.created_at)], ["Student", esc(r.student_number || "—")], ["Problem", `<span class="prewrap">${esc(r.description)}</span>`],
        ["Assigned to", esc(r.assigned_name || "Not assigned yet")], r.assigned_at ? ["Assigned", fmtTime(r.assigned_at)] : null,
        r.started_at ? ["Started", fmtTime(r.started_at)] : null, r.completed_at ? ["Finished", fmtTime(r.completed_at)] : null,
        r.hours_taken !== null && r.hours_taken !== undefined ? ["Time taken", `${r.hours_taken} hours`] : null,
        ["Repair cost", money(r.repair_cost)], r.resolution_note ? ["Technician’s note", esc(r.resolution_note)] : null
      ])}
      ${section(`Photos (${d.photos.length})`)}
      ${photoGallery(d.photos, true)}
      <div class="modal-actions">
        <button class="btn ghost" data-action="repair-photos" data-id="${r.repair_id}">Add photos</button>
        ${isRole("warden", "administrator") && r.repair_status !== "Completed" ? `<button class="btn ghost" data-action="repair-assign" data-id="${r.repair_id}">Assign</button>` : ""}
        ${isRole("warden", "administrator", "maintenance") && r.repair_status !== "Completed" ? `<button class="btn" data-action="repair-update" data-id="${r.repair_id}">Update</button>` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["repair-open"] = (el) => openRepair(el.dataset.id);

actions["repair-photos"] = async (el) => {
  const pid = `repair-add-${el.dataset.id}`;
  photoState[pid] = [];
  const v = await formModal({ title: "Add photos", fields: [], extra: photoPicker(pid, { max: 6, label: "Add photos" }), submitText: "Save photos" });
  if (!v) return;
  if (photosBusy(pid)) { toast("Photos are still uploading — try again in a moment.", "error"); return; }
  const ids = photoIds(pid);
  if (ids.length) { await attempt(() => api(`/repairs/${el.dataset.id}/photos`, { method: "POST", body: { photo_ids: ids } })); openRepair(el.dataset.id); }
};

actions["repair-assign"] = async (el) => {
  const staff = state.d.repairs ? state.d.repairs.staff : [];
  if (!staff.length) { toast("There are no maintenance staff accounts yet. Ask the administrator to create one.", "error"); return; }
  const v = await formModal({
    title: "Assign this job",
    fields: [{ name: "user_id", label: "Technician", type: "select", required: true, options: staff.map((s) => ({ value: s.user_id, label: s.full_name })), blank: "Choose a technician" }],
    submitText: "Assign"
  });
  if (!v) return;
  const ok = await attempt(() => api(`/repairs/${el.dataset.id}/assign`, { method: "POST", body: { user_id: Number(v.user_id) } }));
  if (ok) closeModal("modal");
};

actions["repair-update"] = async (el) => {
  const id = el.dataset.id;
  const r = (await api(`/repairs/${id}`)).repair;
  const v = await formModal({
    title: `Update ${r.request_number}`,
    fields: [
      { name: "status", label: "Status", type: "select", required: true, options: REPAIR_FLOW, value: r.repair_status },
      { name: "repair_cost", label: "Repair cost so far (RM)", type: "number", value: Number(r.repair_cost || 0), hint: "Fill in the final cost when you finish the job." },
      { name: "resolution_note", label: "Note", type: "textarea", maxlength: 500, value: r.resolution_note, placeholder: "What was done?" }
    ],
    submitText: "Save update"
  });
  if (!v) return;
  if (v.status === "Completed" && !(await confirmDialog("Mark this repair as completed? Completed repairs cannot be changed afterwards.", { confirmText: "Complete the job" }))) return;
  const ok = await attempt(() => api(`/repairs/${id}/status`, { method: "PATCH", body: { status: v.status, repair_cost: Number(v.repair_cost), resolution_note: v.resolution_note } }));
  if (ok) closeModal("modal");
};

window.openRepair = openRepair;
