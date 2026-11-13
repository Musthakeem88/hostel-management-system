/* js/pages/rooms.js  —  rooms, beds and the item list of each room */

const ROOM_TYPES = ["Single", "Double", "Triple", "Quad", "Standard"];

const roomOptionsHtml = (rooms, { onlyFree = false, selected = "", blank = "Select room" } = {}) =>
  `<option value="">${esc(blank)}</option>` + rooms
    .filter((r) => !onlyFree || (!r.under_maintenance && Number(r.occupied) < Number(r.capacity)))
    .map((r) => `<option value="${esc(r.room_id)}"${r.room_id === selected ? " selected" : ""}>${esc(r.room_id)} — ${r.capacity - r.occupied} bed(s) free${r.under_maintenance ? " (maintenance)" : ""}</option>`).join("");

pages.rooms = {
  async load() {
    state.d.rooms = await api("/rooms");
  },

  render() {
    const rooms = state.d.rooms;
    const f = ui("rooms", { status: "All", block: "", q: "" });
    const blocks = Array.from(new Set(rooms.map((r) => r.block))).sort();

    const counts = { All: rooms.length, Available: 0, Occupied: 0, Full: 0, Maintenance: 0 };
    rooms.forEach((r) => { counts[roomStatus(r)] += 1; });

    const list = rooms.filter((r) =>
      (f.status === "All" || roomStatus(r) === f.status) &&
      (!f.block || r.block === f.block) &&
      matches(r, f.q, ["room_id", "room_type"]));

    return `
      <div class="toolbar">
        ${filterChips("rooms.status", ["All", "Available", "Occupied", "Full", "Maintenance"], f.status, counts)}
        <select data-change="filter" data-filter="rooms.block" aria-label="Hostel">
          <option value="">All hostels</option>${options(blocks.map((b) => ({ value: b, label: `Block ${b}` })), f.block)}
        </select>
        <input class="grow" type="search" placeholder="Find a room…" value="${esc(f.q)}" data-input="filter" data-filter="rooms.q" aria-label="Find a room">
        ${isRole("administrator") ? '<button class="btn" data-action="room-add">Add room</button>' : ""}
        ${can("reports") ? '<button class="btn ghost" data-action="export" data-report="occupancy" data-format="xlsx">Export</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Room", render: (r) => `<button class="link" data-action="room-open" data-id="${esc(r.room_id)}">${esc(r.room_id)}</button>` },
          { label: "Hostel", render: (r) => `Block ${esc(r.block)}` },
          { label: "Floor", key: "floor" },
          { label: "Type", key: "room_type" },
          { label: "Beds used", render: (r) => `${r.occupied} / ${r.capacity}` },
          { label: "Status", render: (r) => badge(roomStatus(r)) },
          { label: "", render: (r) => `<div class="row-actions"><button class="btn ghost small" data-action="room-open" data-id="${esc(r.room_id)}">Details</button>${isRole("administrator") ? `<button class="btn ghost small" data-action="room-edit" data-id="${esc(r.room_id)}">Edit</button>` : ""}</div>` }
        ], list, { empty: "No rooms match this filter." })}
      </div>`;
  }
};

/* one handler for every filter chip / select / search box:  data-filter="page.key" */
actions.chip = (el) => { setFilter(el.dataset.filter, el.dataset.value); };
changes.filter = (el) => { setFilter(el.dataset.filter, el.value); };

function setFilter(path, value) {
  const [page, key] = path.split(".");
  ui(page)[key] = value;
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.input ? { path: active.dataset.filter, start: active.selectionStart } : null;
  rerender();
  if (keep) {                                   // keep typing in the search box
    const box = document.querySelector(`[data-input][data-filter="${keep.path}"]`);
    if (box) { box.focus(); try { box.setSelectionRange(keep.start, keep.start); } catch { /* not a text box */ } }
  }
}

async function openRoom(id) {
  try {
    const d = await api(`/rooms/${encodeURIComponent(id)}/detail`);
    const room = d.room;
    const byBed = new Map(d.residents.map((r) => [r.student_number, r]));

    openModal(`
      ${modalHead(`Room ${room.room_id}`)}
      ${dl([["Hostel", `Block ${esc(room.block)}`], ["Floor", room.floor], ["Type", esc(room.room_type)], ["Status", badge(roomStatus(room))], ["Beds", `${room.occupied} used of ${room.capacity}`]])}

      ${section("Beds and residents")}
      ${tbl([
        { label: "Bed", key: "bed_number" },
        { label: "Resident", render: (b) => (b.student_number ? `${esc(byBed.get(b.student_number)?.full_name || "")} <span class="muted">${esc(b.student_number)}</span>` : '<span class="muted">Empty</span>') },
        { label: "Status", render: (b) => badge(b.status) }
      ], d.beds, { empty: "No beds." })}

      ${section(`University items (${d.items.length})`)}
      ${tbl([
        { label: "Code", render: (i) => `<span class="mono">${esc(i.item_code)}</span>` },
        { label: "Item", key: "item_name" },
        { label: "Condition", render: (i) => badge(i.item_condition) },
        { label: "Status", render: (i) => badge(i.status) },
        { label: "", render: (i) => (can("items") ? `<button class="btn ghost small" data-action="item-open" data-id="${i.property_id}">History</button>` : "") }
      ], d.items, { empty: "No items are listed for this room yet." })}

      <div class="modal-actions">
        ${isRole("administrator") ? `<button class="btn ghost" data-action="room-standard" data-id="${esc(room.room_id)}">Add standard items</button>` : ""}
        <button class="btn ghost" data-action="close-modal">Close</button>
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["room-open"] = (el) => openRoom(el.dataset.id);

actions["room-standard"] = async (el) => {
  await attempt(() => api(`/rooms/${encodeURIComponent(el.dataset.id)}/standard-items`, { method: "POST", body: {} }));
  openRoom(el.dataset.id);
};

actions["room-add"] = async () => {
  const hostels = await api("/hostels").catch(() => []);
  const v = await formModal({
    title: "Add a room",
    fields: [
      { name: "block", label: "Hostel block", type: "text", required: true, maxlength: 10, list: "hostel-blocks", hint: "Choose an existing block or type a new one." },
      { name: "floor", label: "Floor", type: "number", required: true, min: 0, step: 1, value: 1 },
      { name: "room_number", label: "Room number", type: "number", required: true, min: 1, step: 1 },
      { name: "capacity", label: "Number of beds", type: "number", required: true, min: 1, max: 12, step: 1, value: 2 },
      { name: "room_type", label: "Room type", type: "select", options: ROOM_TYPES, value: "Double" },
      { name: "standard_items", label: "Add the standard item list (beds, desks, chairs, fan, lights…)", type: "checkbox", value: true }
    ],
    extra: `<datalist id="hostel-blocks">${hostels.map((h) => `<option value="${esc(h.block)}">`).join("")}</datalist>`,
    submitText: "Add room"
  });
  if (!v) return;
  attempt(() => api("/rooms", { method: "POST", body: { ...v, floor: Number(v.floor), room_number: Number(v.room_number), capacity: Number(v.capacity) } }));
};

actions["room-edit"] = async (el) => {
  const room = state.d.rooms.find((r) => r.room_id === el.dataset.id);
  if (!room) return;
  const v = await formModal({
    title: `Edit room ${room.room_id}`,
    fields: [
      { name: "capacity", label: "Number of beds", type: "number", required: true, min: Math.max(1, room.occupied), max: 12, step: 1, value: room.capacity, hint: `${room.occupied} student(s) live here now.` },
      { name: "room_type", label: "Room type", type: "select", options: ROOM_TYPES, value: room.room_type },
      { name: "under_maintenance", label: "Room is closed for maintenance (nobody can be allocated)", type: "checkbox", value: room.under_maintenance }
    ]
  });
  if (v) attempt(() => api(`/rooms/${encodeURIComponent(room.room_id)}`, { method: "PUT", body: { capacity: Number(v.capacity), room_type: v.room_type, under_maintenance: v.under_maintenance } }));
};

/* download a report straight from a list page */
actions.export = (el) => downloadFile(`/reports/${el.dataset.report}?format=${el.dataset.format}${el.dataset.query ? "&" + el.dataset.query : ""}`);
