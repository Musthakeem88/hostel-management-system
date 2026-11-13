/* js/pages/myroom.js  —  a student's room, its items and the check-in confirmation */

pages.myroom = {
  async load() {
    const [room, inspections] = await Promise.all([api("/profile/room"), api("/inspections")]);
    state.d.myroom = { ...room, inspections };
  },

  render() {
    const { room, items, inspections } = state.d.myroom;

    if (!room) return `<div class="card"><div class="empty-card"><b>You do not have a room yet</b>Apply for a room and the hostel office will allocate one.
      <div class="row-actions" style="justify-content:center;margin-top:12px"><button class="btn" data-goto="applications">Apply for a room</button></div></div></div>`;

    const pending = inspections.filter((i) => i.inspection_type === "Check-in" && i.confirmation_status === "Pending");

    return `
      ${pending.map((i) => `
        <div class="notice info"><b>Please confirm your room condition.</b> Check-in recorded on ${fmtTime(i.inspection_date)} by ${esc(i.inspector_name || "the warden")}.
          <div class="row-actions">
            <button class="btn small" data-action="view-inspection" data-id="${i.inspection_id}">Review the photos</button>
            <button class="btn small good" data-action="checkin-confirm" data-id="${i.inspection_id}">It is correct</button>
            <button class="btn small ghost danger" data-action="checkin-dispute" data-id="${i.inspection_id}">Something is wrong</button>
          </div></div>`).join("")}

      <div class="stats">
        ${statCard("Room", esc(room.room_id))}
        ${statCard("Hostel", `Block ${esc(room.hostel)}`)}
        ${statCard("Room type", esc(room.room_type))}
        ${statCard("People in room", `${room.occupied} / ${room.capacity}`)}
      </div>

      <div class="card">
        <div class="card-head"><h3>University items in my room</h3><button class="btn small" data-goto="repairs">Report a problem</button></div>
        <p class="muted">These items belong to the university. You are responsible for looking after them.</p>
        ${tbl([
          { label: "Item code", render: (i) => `<span class="mono">${esc(i.item_code)}</span>` },
          { label: "Item", key: "item_name" },
          { label: "Condition", render: (i) => badge(i.item_condition) },
          { label: "Status", render: (i) => badge(i.status) }
        ], items, { empty: "No items are listed for your room yet." })}
      </div>

      <div class="card">
        <h3>My room inspections</h3>
        ${tbl([
          { label: "Date", render: (i) => fmtTime(i.inspection_date) },
          { label: "Type", render: (i) => badge(i.inspection_type, "info") },
          { label: "Inspector", render: (i) => esc(i.inspector_name || "—") },
          { label: "Confirmation", render: (i) => badge(i.confirmation_status) },
          { label: "", render: (i) => `<div class="row-actions"><button class="btn ghost small" data-action="view-inspection" data-id="${i.inspection_id}">View</button>${i.inspection_type === "Check-out" ? `<button class="btn ghost small" data-action="compare-inspection" data-id="${i.inspection_id}">Compare</button>` : ""}</div>` }
        ], inspections, { empty: "No inspections yet." })}
      </div>`;
  }
};

actions["checkin-confirm"] = async (el) => {
  if (!(await confirmDialog("Confirm that the condition recorded for your room is correct?", { confirmText: "Yes, it is correct" }))) return;
  attempt(() => api(`/inspections/${el.dataset.id}/confirm`, { method: "POST", body: { action: "confirm" } }));
};

actions["checkin-dispute"] = async (el) => {
  const v = await formModal({
    title: "Something is wrong",
    intro: "Tell the warden what is different from what was recorded (for example, a scratch that was already there).",
    fields: [{ name: "comment", label: "What is wrong?", type: "textarea", required: true, maxlength: 500 }],
    submitText: "Send to the warden"
  });
  if (v) attempt(() => api(`/inspections/${el.dataset.id}/confirm`, { method: "POST", body: { action: "dispute", comment: v.comment } }));
};
