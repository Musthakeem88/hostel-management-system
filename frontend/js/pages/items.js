/* js/pages/items.js  —  every university item: condition, history, damage and repairs */

pages.items = {
  async load() {
    const [items, types, rooms] = await Promise.all([api("/items"), api("/items/types"), api("/rooms").catch(() => [])]);
    state.d.items = { items, types, rooms };
  },

  render() {
    const { items, rooms } = state.d.items;
    const f = ui("items", { condition: "All", status: "", room: "", q: "" });

    const list = items.filter((i) =>
      (f.condition === "All" || i.item_condition === f.condition) &&
      (!f.status || i.status === f.status) &&
      (!f.room || i.room_id === f.room) &&
      matches(i, f.q, ["item_code", "item_name", "room_id"]));

    const counts = { All: items.length };
    CONDITIONS.forEach((c) => { counts[c] = items.filter((i) => i.item_condition === c).length; });

    return `
      <div class="toolbar">
        ${filterChips("items.condition", ["All", ...CONDITIONS], f.condition, counts)}
        <select data-change="filter" data-filter="items.status" aria-label="Status"><option value="">Any status</option>${options(["In use", "Under repair", "Replaced", "Retired"], f.status)}</select>
        <select data-change="filter" data-filter="items.room" aria-label="Room">${roomOptionsHtml(rooms.length ? rooms : [], { blank: "All rooms", selected: f.room })}</select>
        <input class="grow" type="search" placeholder="Search item code or name…" value="${esc(f.q)}" data-input="filter" data-filter="items.q" aria-label="Search items">
        ${can("reports") ? '<button class="btn ghost" data-action="export" data-report="items" data-format="xlsx">Export</button>' : ""}
        ${isRole("warden", "administrator") ? '<button class="btn" data-action="item-add">Add item</button>' : ""}
        ${isRole("administrator") ? '<button class="btn ghost" data-action="item-type-add">New item type</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Item code", render: (i) => `<button class="link mono" data-action="item-open" data-id="${i.property_id}">${esc(i.item_code)}</button>` },
          { label: "Item", key: "item_name" },
          { label: "Room", key: "room_id" },
          { label: "Condition", render: (i) => badge(i.item_condition) },
          { label: "Status", render: (i) => badge(i.status) },
          { label: "Damages", key: "damage_count", num: true },
          { label: "Repairs (RM)", render: (i) => Number(i.repair_cost_total).toFixed(2), num: true }
        ], list.slice(0, 300), { empty: "No items match this filter." })}
        ${list.length > 300 ? `<p class="muted">Showing the first 300 of ${list.length} items. Narrow the search to see the rest.</p>` : ""}
      </div>`;
  }
};

async function openItem(id) {
  try {
    const d = await api(`/items/${id}`);
    const i = d.item;

    openModal(`
      ${modalHead(`${i.item_name} · ${i.item_code}`)}
      ${dl([["Room", esc(i.room_id)], ["Type", esc(i.type_name)], ["Condition", badge(i.item_condition)], ["Status", badge(i.status)],
            ["In the hostel since", fmtDate(i.acquired_on)], ["Repair cost so far", money(i.repair_cost_total)], ["Replacement cost", money(i.replacement_cost)], i.notes ? ["Notes", esc(i.notes)] : null])}

      ${section("History of this item")}
      <ul class="timeline">
        ${d.history.map((h) => `
          <li class="${esc(String(h.event_type).replaceAll(" ", "-"))}"><b>${esc(h.event_type)}${h.item_condition ? ` · ${esc(h.item_condition)}` : ""}</b>
            <small>${fmtDate(h.event_date)}${h.actor ? ` · ${esc(h.actor)}` : ""}${h.student_number ? ` · student ${esc(h.student_number)}` : ""}</small>
            ${h.note ? `<div>${esc(h.note)}</div>` : ""}</li>`).join("") || '<li class="muted">No history yet.</li>'}
      </ul>

      ${d.damages.length ? `${section("Damage reports")}${tbl([
        { label: "Report", render: (x) => (can("damage") ? `<button class="link" data-action="damage-open" data-id="${x.damage_id}">${esc(x.report_number)}</button>` : esc(x.report_number)) },
        { label: "Student", key: "student_number" }, { label: "What happened", key: "description", cls: "wrap" },
        { label: "Status", render: (x) => badge(x.damage_status || "Reported") }, { label: "Fine", render: (x) => money(x.fine_amount), num: true }
      ], d.damages)}` : ""}

      ${d.repairs.length ? `${section("Repairs")}${tbl([
        { label: "Request", key: "request_number" }, { label: "Description", key: "description", cls: "wrap" },
        { label: "Status", render: (x) => badge(x.repair_status) }, { label: "Cost", render: (x) => money(x.repair_cost), num: true }
      ], d.repairs)}` : ""}

      <div class="modal-actions">
        ${isRole("administrator") ? `<button class="btn ghost" data-action="item-edit" data-id="${i.property_id}">Edit</button>
          ${["Replaced", "Retired"].includes(i.status) ? "" : `<button class="btn ghost danger" data-action="item-replace" data-id="${i.property_id}">Replace with a new one</button>`}` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["item-open"] = (el) => openItem(el.dataset.id);

actions["item-add"] = async () => {
  const { types, rooms } = state.d.items;
  const v = await formModal({
    title: "Add an item to a room",
    fields: [
      { name: "type_id", label: "Item type", type: "select", required: true, options: types.map((t) => ({ value: t.type_id, label: t.name })) },
      { name: "room_id", label: "Room", type: "select", required: true, options: rooms.map((r) => ({ value: r.room_id, label: r.room_id })), blank: "Select room" },
      { name: "item_condition", label: "Condition", type: "select", options: CONDITIONS, value: "Good" },
      { name: "note", label: "Note", maxlength: 200 }
    ],
    submitText: "Add item"
  });
  if (v) attempt(() => api("/items", { method: "POST", body: { ...v, type_id: Number(v.type_id) } }));
};

actions["item-type-add"] = async () => {
  const v = await formModal({
    title: "New item type",
    fields: [
      { name: "name", label: "Name", required: true, maxlength: 60 },
      { name: "code", label: "Short code (2–4 letters)", required: true, maxlength: 4, hint: "Used in item codes, for example CH for Chair." },
      { name: "standard_qty", label: "How many in each room", type: "number", min: 0, step: 1, value: 1 },
      { name: "per_bed", label: "One per bed (instead of a fixed number)", type: "checkbox" },
      { name: "replacement_cost", label: "Replacement cost (RM)", type: "number", value: 0 }
    ]
  });
  if (v) attempt(() => api("/items/types", { method: "POST", body: { ...v, standard_qty: Number(v.standard_qty), replacement_cost: Number(v.replacement_cost) } }));
};

actions["item-edit"] = async (el) => {
  const d = await api(`/items/${el.dataset.id}`);
  const i = d.item;
  const v = await formModal({
    title: `Edit ${i.item_code}`,
    fields: [
      { name: "item_condition", label: "Condition", type: "select", options: CONDITIONS, value: i.item_condition },
      { name: "status", label: "Status", type: "select", options: ["In use", "Under repair", "Replaced", "Retired"], value: i.status },
      { name: "replacement_cost", label: "Replacement cost (RM)", type: "number", value: Number(i.replacement_cost) },
      { name: "notes", label: "Notes", type: "textarea", maxlength: 500, value: i.notes }
    ]
  });
  if (!v) return;
  const ok = await attempt(() => api(`/items/${i.property_id}`, { method: "PUT", body: { ...v, replacement_cost: Number(v.replacement_cost) } }));
  if (ok) openItem(i.property_id);
};

actions["item-replace"] = async (el) => {
  if (!(await confirmDialog("Mark this item as replaced and add a new one of the same type to the room?", { confirmText: "Replace", danger: true }))) return;
  const ok = await attempt(() => api(`/items/${el.dataset.id}/replace`, { method: "POST", body: {} }));
  if (ok) closeModal("modal");
};
