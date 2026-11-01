/* js/pages/applications.js  —  students apply for rooms; the administrator approves, with a waiting list */

pages.applications = {
  async load() {
    const d = { apps: await api("/applications"), hostels: [], rooms: [], mine: null };
    if (isRole("student")) { [d.hostels, d.mine] = await Promise.all([api("/hostels"), api("/profile/room")]); }
    if (isRole("administrator")) d.rooms = await api("/rooms");
    state.d.applications = d;
  },

  render() {
    return isRole("student") ? studentApplications() : staffApplications();
  }
};

function studentApplications() {
  const { apps, hostels, mine } = state.d.applications;
  const resident = Boolean(mine && mine.room && mine.room.resident);
  const open = apps.some((a) => ["Pending", "Waitlisted"].includes(a.status));

  return `
    ${resident ? `<div class="notice good">You already have a room: <b>${esc(mine.room.room_id)}</b>. You can ask for a different room under “Room transfers”.</div>` : ""}

    ${!resident && !open ? `
    <div class="card">
      <h3>Apply for a hostel room</h3>
      <p class="muted">The administrator decides. If no room is free you will be put on the waiting list and given a room automatically when one is available.</p>
      <form data-form="application-save">
        <div class="form">
          <label>Preferred hostel
            <select name="preferred_block"><option value="">No preference</option>${hostels.map((h) => `<option value="${esc(h.block)}">${esc(h.name)} — ${h.available_beds} bed(s) free</option>`).join("")}</select>
          </label>
          <label>Preferred room type<select name="preferred_room_type"><option value="">No preference</option>${options(["Single", "Double", "Triple", "Quad"])}</select></label>
          <label>Faculty<input name="faculty" maxlength="120"></label>
          <label>Phone<input name="phone" maxlength="30"></label>
        </div>
        <label>Anything we should know?<textarea name="notes" maxlength="500" placeholder="For example: needs a ground-floor room"></textarea></label>
        <button class="btn" type="submit" style="margin-top:14px">Submit application</button>
      </form>
    </div>` : ""}

    <div class="card">
      <h3>My applications</h3>
      ${tbl([
        { label: "Application", render: (a) => `<span class="mono">${esc(a.application_number)}</span>` },
        { label: "Applied", render: (a) => fmtDate(String(a.created_at).slice(0, 10)) },
        { label: "Preference", render: (a) => esc([a.preferred_block ? `Block ${a.preferred_block}` : "", a.preferred_room_type].filter(Boolean).join(", ") || "None") },
        { label: "Status", render: (a) => `${badge(a.status)}${a.waitlist_position ? ` <span class="pill">position ${a.waitlist_position}</span>` : ""}` },
        { label: "Room", render: (a) => esc(a.assigned_room || "—") },
        { label: "Decision", render: (a) => esc(a.decision_note || "—"), cls: "wrap" },
        { label: "", render: (a) => (["Pending", "Waitlisted"].includes(a.status) ? `<button class="btn ghost small danger" data-action="application-cancel" data-id="${a.application_id}">Cancel</button>` : "") }
      ], apps, { empty: "You have not applied for a room yet." })}
    </div>`;
}

function staffApplications() {
  const { apps } = state.d.applications;
  const admin = isRole("administrator");
  const f = ui("applications", { status: "Pending" });
  const statuses = ["All", "Pending", "Waitlisted", "Approved", "Rejected", "Cancelled"];
  const counts = { All: apps.length };
  statuses.slice(1).forEach((s) => { counts[s] = apps.filter((a) => a.status === s).length; });
  const list = apps.filter((a) => f.status === "All" || a.status === f.status);

  return `
    <div class="toolbar">
      ${filterChips("applications.status", statuses, f.status, counts)}
      ${admin ? '<button class="btn ghost" data-action="process-waitlist">Give free rooms to the waiting list</button>' : ""}
    </div>
    <div class="card">
      ${tbl([
        { label: "Application", render: (a) => `<span class="mono">${esc(a.application_number)}</span>` },
        { label: "Student", render: (a) => `${esc(a.full_name)}<br><span class="muted">${esc(a.student_number)}</span>` },
        { label: "Faculty", render: (a) => esc(a.faculty || "—") },
        { label: "Preference", render: (a) => esc([a.preferred_block ? `Block ${a.preferred_block}` : "", a.preferred_room_type].filter(Boolean).join(", ") || "None") },
        { label: "Applied", render: (a) => fmtDate(String(a.created_at).slice(0, 10)) },
        { label: "Status", render: (a) => `${badge(a.status)}${a.waitlist_position ? ` <span class="pill">#${a.waitlist_position}</span>` : ""}` },
        { label: "Room", render: (a) => esc(a.assigned_room || "—") },
        { label: "", render: (a) => (admin && ["Pending", "Waitlisted"].includes(a.status)
            ? `<div class="row-actions"><button class="btn small" data-action="application-approve" data-id="${a.application_id}">Approve</button>${a.status === "Pending" ? `<button class="btn ghost small" data-action="application-waitlist" data-id="${a.application_id}">Waitlist</button>` : ""}<button class="btn ghost small danger" data-action="application-reject" data-id="${a.application_id}">Reject</button></div>` : "") }
      ], list, { empty: "No applications here." })}
    </div>`;
}

forms["application-save"] = async (form) => {
  await submitting(form, () => attempt(() => api("/applications", { method: "POST", body: formData(form) })));
};

actions["application-cancel"] = async (el) => {
  if (await confirmDialog("Cancel this application?", { confirmText: "Cancel application", danger: true })) attempt(() => api(`/applications/${el.dataset.id}/cancel`, { method: "POST", body: {} }));
};

actions["application-approve"] = async (el) => {
  const { rooms, apps } = state.d.applications;
  const app = apps.find((a) => String(a.application_id) === el.dataset.id);
  const v = await formModal({
    title: `Approve ${app.full_name}`,
    intro: "Leave the room on “Automatic” to give the best free room for their preference. If no room is free, they join the waiting list.",
    fields: [
      { name: "room_id", label: "Room", type: "select", options: rooms.filter((r) => !r.under_maintenance && r.occupied < r.capacity).map((r) => ({ value: r.room_id, label: `${r.room_id} — ${r.capacity - r.occupied} free` })), blank: "Automatic" },
      { name: "note", label: "Note for the student", maxlength: 300 }
    ],
    submitText: "Approve"
  });
  if (v) attempt(() => api(`/applications/${el.dataset.id}/approve`, { method: "POST", body: { room_id: v.room_id || undefined, note: v.note } }));
};

actions["application-waitlist"] = (el) => attempt(() => api(`/applications/${el.dataset.id}/waitlist`, { method: "POST", body: {} }));

actions["application-reject"] = async (el) => {
  const v = await formModal({ title: "Reject this application", fields: [{ name: "note", label: "Reason (the student will see this)", type: "textarea", required: true, maxlength: 300 }], submitText: "Reject", danger: true });
  if (v) attempt(() => api(`/applications/${el.dataset.id}/reject`, { method: "POST", body: { note: v.note } }));
};

actions["process-waitlist"] = () => attempt(() => api("/applications/process-waitlist", { method: "POST", body: {} }));
