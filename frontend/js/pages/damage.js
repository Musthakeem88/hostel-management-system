/* js/pages/damage.js  —  damage reports with photo proof, review by the administrator, fine approval */

let damageDraft = null;

const damageStatus = (d) => d.damage_status || "Reported";

pages.damage = {
  async load() {
    const staff = isRole("warden", "administrator");
    const [damages, rooms] = await Promise.all([api("/damages"), staff ? api("/rooms") : Promise.resolve([])]);
    state.d.damage = { damages, rooms };
    damageDraft = null;
  },

  render() {
    const { damages, rooms } = state.d.damage;
    const f = ui("damage", { status: "All", q: "" });
    const statuses = ["All", "Reported", "Under Investigation", "Confirmed", "Rejected"];
    const counts = { All: damages.length };
    statuses.slice(1).forEach((s) => { counts[s] = damages.filter((d) => damageStatus(d) === s).length; });

    const list = damages.filter((d) => (f.status === "All" || damageStatus(d) === f.status) && matches(d, f.q, ["report_number", "item_name", "student_number", "room_id"]));
    const pre = f.prefill;

    return `
      ${isRole("warden", "administrator") ? `
      <div class="card" id="damage-form-card">
        <h3>Report damaged property</h3>
        <p class="muted">Photos are required. The administrator checks every report before any fine is issued, and the student can appeal.</p>
        <form data-form="damage-save" id="damage-form">
          <div class="form">
            <label>Room *<select name="room" required data-change="damage-room">${roomOptionsHtml(rooms.filter((r) => r.occupied > 0), { blank: "Select a room with residents", selected: pre ? pre.room_id : "" })}</select></label>
            <label>Student *<select name="student" required><option value="">Choose the room first</option></select></label>
            <label>Item *<select name="item" required data-change="damage-item"><option value="">Choose the room first</option></select></label>
            <label id="damage-other" hidden>Item name *<input name="other_item" maxlength="80"></label>
            <label>Type of damage *<select name="damage_type" required data-change="damage-calc">${options(DAMAGE_TYPES, "Accidental damage")}</select></label>
            <label>Repair cost (RM)<input name="repair_cost" type="number" min="0" step="0.01" value="0" data-input="damage-calc"></label>
            <label>Replacement cost (RM)<input name="replacement_cost" type="number" min="0" step="0.01" value="0" data-input="damage-calc"></label>
            <label>Suggested fine (RM)<input name="fine_amount" type="number" min="0" step="0.01" value="0"><small class="muted" id="fine-hint">Normal wear is never fined. Accidents pay the repair, vandalism pays the replacement.</small></label>
          </div>
          <label>What happened? *<textarea name="description" required maxlength="1000" placeholder="Describe the damage">${esc(pre ? pre.description : "")}</textarea></label>
          <div><b>Photo proof *</b>${photoPicker("damage-proof", { max: 10, label: "Add proof photos" })}</div>
          <button class="btn" type="submit" style="margin-top:14px">Create damage report</button>
        </form>
      </div>` : ""}

      <div class="toolbar">
        ${filterChips("damage.status", statuses, f.status, counts)}
        <input class="grow" type="search" placeholder="Search report, item or student…" value="${esc(f.q)}" data-input="filter" data-filter="damage.q" aria-label="Search damage reports">
        ${can("reports") ? '<button class="btn ghost" data-action="export" data-report="damage" data-format="xlsx">Export</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Report", render: (d) => `<button class="link mono" data-action="damage-open" data-id="${d.damage_id}">${esc(d.report_number)}</button>` },
          { label: "Room", key: "room_id" },
          { label: "Item", key: "item_name" },
          { label: "Student", key: "student_number" },
          { label: "Description", key: "description", cls: "wrap" },
          { label: "Type", render: (d) => esc(d.damage_type || "—") },
          { label: "Proof", render: (d) => `${d.evidence_count ?? 0} photo${d.evidence_count === 1 ? "" : "s"}` },
          { label: "Status", render: (d) => badge(damageStatus(d)) },
          { label: "Fine", render: (d) => money(d.fine_amount), num: true },
          { label: "Fine status", render: (d) => badge(d.fine_status) },
          { label: "", render: (d) => damageButtons(d) }
        ], list, { empty: "No damage reports found." })}
      </div>`;
  },

  ready() {
    const pre = ui("damage").prefill;
    if (pre) {
      const room = $('#damage-form [name="room"]');
      if (room) { room.value = pre.room_id; room.dispatchEvent(new Event("change", { bubbles: true })); }
      const card = $("#damage-form-card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
};

function damageButtons(d) {
  const st = damageStatus(d);
  const admin = isRole("administrator");
  const parts = [`<button class="btn ghost small" data-action="damage-open" data-id="${d.damage_id}">View</button>`];

  if (admin && ["Reported", "Under Investigation"].includes(st)) {
    parts.push(`<button class="btn small" data-action="damage-review" data-id="${d.damage_id}">Review</button>`);
  }
  if (admin && st === "Confirmed" && !d.fine_id && d.damage_type !== "Normal wear" && d.fine_status !== "Waived") {
    parts.push(`<button class="btn small" data-action="fine-create" data-id="${d.damage_id}">Approve fine</button>`);
  }
  return `<div class="row-actions">${parts.join("")}</div>`;
}

/* ---------- the report form ---------- */

changes["damage-room"] = async (select) => {
  const student = $('#damage-form [name="student"]');
  const item = $('#damage-form [name="item"]');
  if (!select.value) { student.innerHTML = '<option value="">Choose the room first</option>'; item.innerHTML = '<option value="">Choose the room first</option>'; return; }

  try {
    const d = await api(`/inspections/room-items?room_id=${encodeURIComponent(select.value)}`);
    damageDraft = d;
    const pre = ui("damage").prefill;

    student.innerHTML = `<option value="">Select the student</option>${options(d.residents.map((r) => ({ value: r.student_number, label: `${r.full_name} (${r.student_number})` })), pre ? pre.student_number : (d.residents.length === 1 ? d.residents[0].student_number : ""))}`;
    item.innerHTML = `<option value="">Select the item</option>${d.items.map((i) => `<option value="${i.property_id ?? ""}" data-name="${esc(i.item)}">${esc(i.item)}${i.item_code ? ` (${esc(i.item_code)})` : ""}</option>`).join("")}<option value="other">Other item…</option>`;

    if (pre) {
      const match = Array.from(item.options).find((o) => (pre.property_id && o.value === String(pre.property_id)) || o.dataset.name === pre.item);
      if (match) item.value = match.value; else { item.value = "other"; $('#damage-form [name="other_item"]').value = pre.item; }
      item.dispatchEvent(new Event("change", { bubbles: true }));
      ui("damage").inspection_id = pre.inspection_id || null;
      ui("damage").prefill = null;
    }
  } catch (error) { toast(error.message, "error"); }
};

changes["damage-item"] = (select) => { $("#damage-other").hidden = select.value !== "other"; };

changes["damage-calc"] = () => {
  const form = $("#damage-form");
  if (!form) return;
  const type = form.elements.damage_type.value;
  const repair = Number(form.elements.repair_cost.value || 0);
  const replace = Number(form.elements.replacement_cost.value || 0);
  const fine = type === "Normal wear" ? 0 : type === "Confirmed vandalism" ? (replace || repair) : repair;
  form.elements.fine_amount.value = fine.toFixed(2);
  $("#fine-hint").textContent = type === "Normal wear" ? "Normal wear is never fined." : type === "Confirmed vandalism" ? "Vandalism: the student pays the replacement cost." : "Accidental damage: the student pays the repair cost.";
};

forms["damage-save"] = async (form) => {
  if (photosBusy("damage-proof")) { toast("Photos are still uploading — please wait a moment.", "error"); return; }
  const v = formData(form);
  const proof = photoIds("damage-proof");
  if (!proof.length) { toast("Add at least one proof photo.", "error"); return; }

  const select = form.querySelector('[name="item"]');
  const name = v.item === "other" ? v.other_item : (select.selectedOptions[0] && select.selectedOptions[0].dataset.name);
  if (!name) { toast("Choose or type the item.", "error"); return; }

  await submitting(form, async () => {
    const result = await attempt(() => api("/damages", { method: "POST", body: {
      room_id: v.room, student_number: v.student, item_name: name, property_id: v.item && v.item !== "other" ? Number(v.item) : undefined,
      description: v.description, damage_type: v.damage_type, repair_cost: Number(v.repair_cost || 0), replacement_cost: Number(v.replacement_cost || 0),
      fine_amount: Number(v.fine_amount || 0), evidence_photo_ids: proof, inspection_id: damageDraft && ui("damage").inspection_id ? ui("damage").inspection_id : undefined
    } }));
    if (result) { resetPhotos("damage-proof"); delete photoState["damage-proof"]; }
  });
};

/* ---------- one report ---------- */

async function openDamage(id) {
  try {
    const d = await api(`/damages/${id}`);
    const x = d.damage;
    const st = damageStatus(x);
    const admin = isRole("administrator");

    openModal(`
      ${modalHead(`Damage report ${x.report_number}`)}
      ${dl([
        ["Status", badge(st)], ["Type", esc(x.damage_type || "Not classified yet")], ["Room", esc(x.room_id)], ["Item", esc(x.item_name)],
        ["Student", esc(x.student_number)], ["Reported by", esc(x.reported_by_name || "—")], ["Reported", fmtTime(x.created_at)],
        ["What happened", `<span class="prewrap">${esc(x.description)}</span>`],
        ["Repair cost", money(x.repair_cost)], ["Replacement cost", money(x.replacement_cost)], ["Suggested fine", money(x.fine_amount)],
        x.review_note ? ["Review note", esc(x.review_note)] : null
      ])}

      ${section(`Photo proof (${d.evidence.length})`)}
      ${photoGallery(d.evidence, true)}

      ${d.fine ? `${section("Fine")}${dl([["Fine number", `<span class="mono">${esc(d.fine.fine_number)}</span>`], ["Amount", `<b>${money(d.fine.amount)}</b>`], ["Status", badge(d.fine.status)],
          ["Due", fmtDate(d.fine.due_date)], ["Approved by", esc(d.fine.approved_by_name || "—")], ["Reason", esc(d.fine.reason)]])}
          ${d.appeals.length ? `${section("Appeals")}${d.appeals.map((a) => `<p><b>${esc(a.status)}</b> · ${fmtTime(a.created_at)}<br>${esc(a.reason)}${a.decision_note ? `<br><span class="muted">Decision: ${esc(a.decision_note)} (${esc(a.decided_by_name || "")})</span>` : ""}</p>`).join("")}` : ""}` : ""}

      <div class="modal-actions">
        ${isRole("warden", "administrator") ? '<button class="btn ghost" data-action="damage-add-photos" data-id="' + x.damage_id + '">Add photos</button>' : ""}
        ${admin && ["Reported", "Under Investigation"].includes(st) ? `<button class="btn" data-action="damage-review" data-id="${x.damage_id}">Review</button>` : ""}
        ${admin && st === "Confirmed" && !d.fine && x.damage_type !== "Normal wear" ? `<button class="btn" data-action="fine-create" data-id="${x.damage_id}">Approve fine</button>` : ""}
        ${d.fine && can("fines") ? `<button class="btn ghost" data-action="fine-open" data-id="${d.fine.fine_id}">Open fine</button>` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["damage-open"] = (el) => openDamage(el.dataset.id);

actions["damage-add-photos"] = async (el) => {
  const pid = `damage-add-${el.dataset.id}`;
  photoState[pid] = [];
  const v = await formModal({ title: "Add proof photos", fields: [], extra: photoPicker(pid, { max: 10, label: "Add photos" }), submitText: "Save photos" });
  if (!v) return;
  if (photosBusy(pid)) { toast("Photos are still uploading — try again in a moment.", "error"); return; }
  const ids = photoIds(pid);
  if (!ids.length) return;
  await attempt(() => api(`/damages/${el.dataset.id}/evidence`, { method: "POST", body: { photo_ids: ids } }));
  openDamage(el.dataset.id);
};

/* administrator: investigate / confirm / reject */
actions["damage-review"] = async (el) => {
  const id = el.dataset.id;
  const d = (await api(`/damages/${id}`)).damage;

  const v = await formModal({
    title: `Review ${d.report_number}`,
    intro: "Check the photos, then decide. A fine can only be approved after the damage is confirmed.",
    fields: [
      { name: "action", label: "Decision", type: "select", required: true, options: [{ value: "confirm", label: "Confirm the damage" }, { value: "investigate", label: "Needs investigation" }, { value: "reject", label: "Reject the report" }], value: "confirm" },
      { name: "damage_type", label: "Type of damage (when confirming)", type: "select", options: DAMAGE_TYPES, value: d.damage_type || "Accidental damage" },
      { name: "repair_cost", label: "Repair cost (RM)", type: "number", value: Number(d.repair_cost || 0) },
      { name: "replacement_cost", label: "Replacement cost (RM)", type: "number", value: Number(d.replacement_cost || 0) },
      { name: "fine_amount", label: "Fine amount (RM) — leave empty to use the university rule", type: "number", value: "" },
      { name: "note", label: "Note (required when rejecting)", type: "textarea", maxlength: 500 },
      { name: "create_repair", label: "Also create a repair request for this item", type: "checkbox", value: true }
    ],
    submitText: "Save decision"
  });
  if (!v) return;

  const body = { action: v.action, note: v.note, create_repair: v.create_repair };
  if (v.action === "confirm") Object.assign(body, { damage_type: v.damage_type, repair_cost: Number(v.repair_cost), replacement_cost: Number(v.replacement_cost), fine_amount: v.fine_amount === "" ? undefined : Number(v.fine_amount) });

  const ok = await attempt(() => api(`/damages/${id}/review`, { method: "POST", body }));
  if (ok) closeModal("modal");
};

/* administrator: approve the fine */
actions["fine-create"] = async (el) => {
  const id = el.dataset.id;
  const d = (await api(`/damages/${id}`)).damage;

  const v = await formModal({
    title: `Approve a fine · ${d.report_number}`,
    intro: `Student ${esc(d.student_number)} · ${esc(d.item_name)}. The student will be told and can appeal.`,
    fields: [
      { name: "amount", label: "Fine amount (RM)", type: "number", required: true, value: Number(d.fine_amount || 0) },
      { name: "reason", label: "Reason (the student will see this)", type: "textarea", required: true, maxlength: 500, value: d.description },
      { name: "due_date", label: "Due date (leave empty for the standard period)", type: "date", min: todayISO() },
      { name: "note", label: "Internal note", maxlength: 300 }
    ],
    submitText: "Approve fine"
  });
  if (!v) return;
  const ok = await attempt(() => api("/fines", { method: "POST", body: { damage_id: Number(id), amount: Number(v.amount), reason: v.reason, due_date: v.due_date || undefined, note: v.note } }));
  if (ok) closeModal("modal");
};

window.openDamage = openDamage;
