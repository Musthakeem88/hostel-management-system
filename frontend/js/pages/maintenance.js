/* js/pages/maintenance.js  —  maintenance jobs: add, view, edit, mark as completed */

const jobOverdue = (j) => j.status !== "Completed" && j.expected_completion_date && j.expected_completion_date < todayISO();

pages.maintenance = {
  async load() {
    const d = { jobs: await api("/maintenance"), rooms: [], staff: [] };
    if (isRole("warden", "administrator")) [d.rooms, d.staff] = await Promise.all([api("/rooms"), api("/users/directory?role=maintenance")]);
    state.d.maintenance = d;
  },

  render() {
    const { jobs, rooms, staff } = state.d.maintenance;
    const f = ui("maintenance", { status: "All" });
    const counts = { All: jobs.length };
    MAINTENANCE_STATUS.forEach((s) => { counts[s] = jobs.filter((j) => j.status === s).length; });
    const list = jobs.filter((j) => f.status === "All" || j.status === f.status);
    const names = Array.from(new Set(jobs.map((j) => j.assigned_staff).filter(Boolean))).sort();

    return `
      ${isRole("warden", "administrator") ? `
      <div class="card">
        <h3>Add maintenance</h3>
        <form data-form="maintenance-save">
          <div class="form">
            <label>Room *<select name="room" required>${roomOptionsHtml(rooms, { blank: "Select room" })}</select></label>
            <label>Maintenance type *<select name="type" required>${options(MAINTENANCE_TYPES)}</select></label>
            <label>Assigned technician<select name="assigned_user_id"><option value="">Not assigned</option>${options(staff.map((s) => ({ value: s.user_id, label: s.full_name })))}</select></label>
            <label>…or a name<input name="staff" maxlength="100" list="staff-names" placeholder="e.g. outside contractor"></label>
            <label>Reported date *<input type="date" name="reported" value="${todayISO()}" required></label>
            <label>Expected completion<input type="date" name="expected" min="${todayISO()}"></label>
          </div>
          <datalist id="staff-names">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
          <label>Problem description *<textarea name="description" maxlength="1000" required></textarea></label>
          <button class="btn" type="submit" style="margin-top:14px">Add maintenance</button>
        </form>
      </div>` : ""}

      <div class="card">
        <h3>Maintenance requests</h3>
        ${filterChips("maintenance.status", ["All", ...MAINTENANCE_STATUS], f.status, counts)}
        ${tbl([
          { label: "Room", render: (j) => esc(roomLabel(j)) },
          { label: "Type", key: "maintenance_type" },
          { label: "Problem", key: "description", cls: "wrap" },
          { label: "Reported", render: (j) => `<span class="nowrap">${fmtDate(j.reported_date)}</span>` },
          { label: "Staff", render: (j) => (j.assigned_staff ? esc(j.assigned_staff) : '<span class="muted">Unassigned</span>') },
          { label: "Status", render: (j) => badge(j.status) },
          { label: "Expected completion", render: (j) => `<span class="nowrap">${j.status === "Completed" && j.completed_date ? `Done ${fmtDate(j.completed_date)}` : fmtDate(j.expected_completion_date)}</span> ${jobOverdue(j) ? '<span class="badge bad">Overdue</span>' : ""}` },
          { label: "Actions", render: (j) => maintenanceButtons(j) }
        ], list, { empty: "No maintenance requests found." })}
      </div>`;
  }
};

function maintenanceButtons(j) {
  const done = j.status === "Completed";
  const parts = [`<button class="btn ghost small" data-action="maint-view" data-id="${j.maintenance_id}">View</button>`];
  if (done) return `<div class="row-actions">${parts.join("")}<span class="badge good">Locked</span></div>`;
  if (isRole("warden", "administrator")) parts.push(`<button class="btn ghost small" data-action="maint-edit" data-id="${j.maintenance_id}">Edit</button>`);
  if (isRole("warden", "administrator", "maintenance")) parts.push(`<button class="btn small" data-action="maint-complete" data-id="${j.maintenance_id}">Mark as completed</button>`);
  return `<div class="row-actions">${parts.join("")}</div>`;
}

const findJob = (id) => state.d.maintenance.jobs.find((j) => String(j.maintenance_id) === String(id));

forms["maintenance-save"] = async (form) => {
  const v = formData(form);
  const parts = String(v.room || "").split("-");
  if (parts.length < 3) { toast("Select a room.", "error"); return; }

  const body = {
    room_block: parts.slice(0, -2).join("-"), room_floor: Number(parts.at(-2)), room_number: Number(parts.at(-1)),
    maintenance_type: v.type, description: v.description, reported_date: v.reported, expected_completion_date: v.expected,
    assigned_user_id: v.assigned_user_id || undefined, assigned_staff: v.staff
  };
  await submitting(form, async () => { const ok = await attempt(() => api("/maintenance", { method: "POST", body })); if (ok) form.reset(); });
};

actions["maint-view"] = (el) => {
  const j = findJob(el.dataset.id);
  if (!j) return;
  openModal(`
    ${modalHead("Maintenance details")}
    ${dl([["Room", esc(roomLabel(j))], ["Maintenance type", esc(j.maintenance_type)], ["Status", `${badge(j.status)} ${jobOverdue(j) ? '<span class="badge bad">Overdue</span>' : ""}`],
          ["Reported date", fmtDate(j.reported_date)], ["Assigned staff", esc(j.assigned_staff || "Unassigned")], ["Expected completion", fmtDate(j.expected_completion_date)],
          j.completed_date ? ["Completed on", fmtDate(j.completed_date)] : null, ["Problem", `<span class="prewrap">${esc(j.description)}</span>`]])}
    <div class="modal-actions">
      ${j.status !== "Completed" && isRole("warden", "administrator") ? `<button class="btn ghost" data-action="maint-edit" data-id="${j.maintenance_id}">Edit</button>` : ""}
      ${j.status !== "Completed" && isRole("warden", "administrator", "maintenance") ? `<button class="btn" data-action="maint-complete" data-id="${j.maintenance_id}">Mark as completed</button>` : ""}
      <button class="btn ghost" data-action="close-modal">Close</button>
    </div>`);
};

actions["maint-edit"] = async (el) => {
  const j = findJob(el.dataset.id);
  if (!j) return;
  const staff = state.d.maintenance.staff;

  const v = await formModal({
    title: "Edit maintenance",
    intro: `Room ${esc(roomLabel(j))} · reported ${fmtDate(j.reported_date)}`,
    fields: [
      { name: "type", label: "Maintenance type", type: "select", required: true, options: MAINTENANCE_TYPES, value: j.maintenance_type },
      { name: "status", label: "Status", type: "select", required: true, options: MAINTENANCE_STATUS, value: j.status },
      { name: "assigned_user_id", label: "Technician", type: "select", options: staff.map((s) => ({ value: s.user_id, label: s.full_name })), blank: "Not assigned / other name", value: j.assigned_user_id || "" },
      { name: "staff", label: "…or a name", maxlength: 100, value: j.assigned_user_id ? "" : j.assigned_staff },
      { name: "expected", label: "Expected completion date", type: "date", min: j.reported_date, value: j.expected_completion_date },
      { name: "description", label: "Problem description", type: "textarea", required: true, maxlength: 1000, value: j.description }
    ],
    submitText: "Save changes"
  });
  if (!v) return;
  const ok = await attempt(() => api(`/maintenance/${j.maintenance_id}`, { method: "PUT", body: {
    maintenance_type: v.type, status: v.status, assigned_user_id: v.assigned_user_id || undefined, assigned_staff: v.staff,
    expected_completion_date: v.expected, description: v.description } }));
  if (ok) closeModal("modal");
};

actions["maint-complete"] = async (el) => {
  const j = findJob(el.dataset.id);
  if (!j) return;
  if (!(await confirmDialog(`Mark the ${j.maintenance_type.toLowerCase()} job in room ${roomLabel(j)} as completed? Completed requests cannot be changed.`, { confirmText: "Mark as completed" }))) return;
  const ok = await attempt(() => api(`/maintenance/${j.maintenance_id}/complete`, { method: "PATCH" }));
  if (ok) closeModal("modal");
};
