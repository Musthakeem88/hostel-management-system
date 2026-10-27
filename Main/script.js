
/* =========================================================
   HOSTEL MANAGEMENT SYSTEM
   Main/script.js
========================================================= */

const API_BASE = "/api";

const $ = (selector) => document.querySelector(selector);
const view = $("#view");
const titleElement = $("#title");
const nav = $("#nav");
const toastElement = $("#toast");

const ITEMS = [
  "Bed", "Mattress", "Desk", "Chair", "Wardrobe",
  "Ceiling fan", "Tube light", "Window", "Sink", "Mirror"
];

const CONDITIONS = ["Good", "Damaged", "Broken"];
const FINE_FLOW = ["Pending", "Under Review", "Approved", "Paid"];
const REPAIR_FLOW = ["Reported", "Assigned", "In Progress", "Completed"];

let rooms = [];
let students = [];
let damages = [];
let repairs = [];
let inspections = [];
let selectedRoomFilter = "All";

/* =========================================================
   HELPERS
========================================================= */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function toast(message) {
  if (!toastElement) {
    alert(message);
    return;
  }

  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 3000);
}

function roomStatus(room) {
  if (room.fix) return "Maintenance";
  if (Number(room.occ) >= Number(room.cap)) return "Full";
  if (Number(room.occ) === 0) return "Available";
  return "Occupied";
}

function tone(status) {
  const value = String(status || "").toLowerCase();

  if (["paid", "completed", "good", "available"].includes(value)) {
    return "good";
  }

  if (["broken", "urgent", "maintenance"].includes(value)) {
    return "bad";
  }

  if (["pending", "damaged", "reported", "under review"].includes(value)) {
    return "warn";
  }

  return "info";
}

function badge(status) {
  return `<span class="badge ${tone(status)}">${esc(status)}</span>`;
}

function roomOptions(includeUnavailable = false) {
  return rooms
    .filter((room) =>
      includeUnavailable || (!room.fix && Number(room.occ) < Number(room.cap))
    )
    .map((room) => `
      <option value="${esc(room.no)}">
        ${esc(room.no)} (${room.occ}/${room.cap})
      </option>
    `)
    .join("");
}

function itemOptions() {
  return ITEMS.map((item) =>
    `<option value="${esc(item)}">${esc(item)}</option>`
  ).join("");
}

function conditionOptions() {
  return CONDITIONS.map((condition) =>
    `<option value="${esc(condition)}">${esc(condition)}</option>`
  ).join("");
}

function getRoom(roomId) {
  return rooms.find((room) => room.no === roomId);
}

function getStudent(studentNumber) {
  return students.find(
    (student) =>
      String(student.student_number || "").trim() ===
      String(studentNumber || "").trim()
  );
}

function formatRoom(block, floor, roomNumber) {
  return `${String(block).trim()}-${String(floor).padStart(2, "0")}-${String(roomNumber).padStart(2, "0")}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

/* =========================================================
   LOAD DATABASE DATA
========================================================= */

async function loadRoomsFromDatabase() {
  try {
    const data = await apiRequest(`${API_BASE}/rooms`);
    const rows = Array.isArray(data) ? data : data.rooms;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected room data received.");
    }

    rooms = rows.map((room) => ({
      no: room.room_id ||
        formatRoom(room.block, room.floor, room.room_number),
      hostel: `Block ${room.block}`,
      cap: Number(room.capacity),
      occ: Number(room.occupied),
      fix: room.under_maintenance === true
    }));

    populateStudentRooms();

    if (view.dataset.name) render(view.dataset.name);
  } catch (error) {
    console.error(error);
    toast("Could not load rooms. Check the backend server.");
  }
}

async function loadStudents() {
  try {
    const data = await apiRequest(`${API_BASE}/students`);
    students = Array.isArray(data) ? data : data.students;

    if (!Array.isArray(students)) {
      throw new Error("Unexpected student data received.");
    }

    if (view.dataset.name === "students") {
      renderStudentsTable();
    } else if (view.dataset.name === "dashboard") {
      render("dashboard");
    }
  } catch (error) {
    console.error(error);
    toast("Could not load students.");
  }
}

async function loadInspections() {
  try {
    const data = await apiRequest(`${API_BASE}/inspections`);
    const rows = Array.isArray(data) ? data : data.inspections;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected inspection data received.");
    }

    inspections = rows.map((row) => {
      let items = row.inspection_items;

      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch {
          items = [];
        }
      }

      return {
        id: `I-${row.inspection_id}`,
        room: formatRoom(row.room_block, row.room_floor, row.room_number),
        type: row.inspection_type,
        student: row.student_number,
        date: row.inspection_date
          ? new Date(row.inspection_date).toLocaleString()
          : "-",
        items: Array.isArray(items) ? items : []
      };
    });

    if (view.dataset.name === "inspections") render("inspections");
  } catch (error) {
    console.error(error);
    toast("Could not load inspections.");
  }
}

async function loadDamages() {
  try {
    const data = await apiRequest(`${API_BASE}/damages`);
    const rows = Array.isArray(data) ? data : data.damages;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected damage report data received.");
    }

    damages = rows.map((row) => ({
      dbId: row.damage_id,
      id: row.report_number || `D-${row.damage_id}`,
      room: formatRoom(row.room_block, row.room_floor, row.room_number),
      item: row.item_name,
      student: row.student_number,
      description: row.description,
      cost: Number(row.fine_amount || 0),
      status: row.fine_status || "Pending",
      disputeReason: row.dispute_reason || ""
    }));

    if (["damage", "dashboard"].includes(view.dataset.name)) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error(error);
    toast("Could not load damage reports.");
  }
}

async function loadRepairs() {
  try {
    const data = await apiRequest(`${API_BASE}/repairs`);
    const rows = Array.isArray(data) ? data : data.repairs;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected repair request data received.");
    }

    repairs = rows.map((row) => ({
      dbId: row.repair_id,
      id: row.request_number || `R-${row.repair_id}`,
      room: formatRoom(row.room_block, row.room_floor, row.room_number),
      item: row.item_name,
      description: row.description,
      priority: row.priority || "Normal",
      status: row.repair_status || "Reported"
    }));

    if (["repairs", "dashboard"].includes(view.dataset.name)) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error(error);
    toast("Could not load repair requests.");
  }
}

/* =========================================================
   STUDENT MANAGEMENT
========================================================= */

function populateStudentRooms() {
  const select = $("#student-room");
  if (!select) return;

  const previousValue = select.value;
  const availableRooms = rooms.filter(
    (room) => !room.fix && Number(room.occ) < Number(room.cap)
  );

  select.innerHTML =
    '<option value="">Select an available room</option>' +
    availableRooms.map((room) => `
      <option value="${esc(room.no)}">
        ${esc(room.no)} — ${room.cap - room.occ} bed(s) available
      </option>
    `).join("");

  if (availableRooms.some((room) => room.no === previousValue)) {
    select.value = previousValue;
  }
}

function renderStudentsTable() {
  const tbody = $("#students-table-body");
  if (!tbody) return;

  tbody.innerHTML = students.length
    ? students.map((student) => `
        <tr>
          <td>${esc(student.student_number)}</td>
          <td>${esc(student.full_name)}</td>
          <td>${esc(student.email)}</td>
          <td>${esc(student.phone || "-")}</td>
          <td>
            Block ${esc(student.room_block)},
            Floor ${esc(student.room_floor)},
            Room ${esc(student.room_number)}
          </td>
        </tr>
      `).join("")
    : '<tr><td colspan="5">No students registered yet.</td></tr>';
}

async function registerStudent(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const roomId = String(data.get("room_id") || "");
  const room = getRoom(roomId);

  if (!room || room.fix || Number(room.occ) >= Number(room.cap)) {
    toast("Please select an available room.");
    await loadRoomsFromDatabase();
    return;
  }

  const parts = roomId.split("-");
  const button = form.querySelector('[type="submit"]');

  if (button) {
    button.disabled = true;
    button.textContent = "Registering...";
  }

  try {
    const result = await apiRequest(`${API_BASE}/students`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_number: String(data.get("student_number") || "").trim(),
        full_name: String(data.get("full_name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2])
      })
    });

    toast(result.message || "Student registered successfully.");
    form.reset();

    await loadRoomsFromDatabase();
    await loadStudents();
    render("students");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Register student";
    }
  }
}

/* =========================================================
   PAGE VIEWS
========================================================= */

const views = {
  dashboard() {
    const available = rooms.filter(
      (room) => !room.fix && room.occ < room.cap
    ).length;

    const full = rooms.filter((room) => room.occ >= room.cap).length;
    const maintenance = rooms.filter((room) => room.fix).length;

    const pendingFines = damages.filter(
      (damage) => damage.status === "Pending"
    ).length;

    const activeRepairs = repairs.filter(
      (repair) => repair.status !== "Completed"
    ).length;

    const capacity = rooms.reduce((sum, room) => sum + room.cap, 0);
    const occupied = rooms.reduce((sum, room) => sum + room.occ, 0);

    return `
      <div class="stats">
        <div class="card"><p>Total rooms</p><h2>${rooms.length}</h2></div>
        <div class="card"><p>Registered students</p><h2>${students.length}</h2></div>
        <div class="card"><p>Available rooms</p><h2>${available}</h2></div>
        <div class="card"><p>Full rooms</p><h2>${full}</h2></div>
        <div class="card"><p>Maintenance rooms</p><h2>${maintenance}</h2></div>
        <div class="card"><p>Occupied beds</p><h2>${occupied} / ${capacity}</h2></div>
        <div class="card"><p>Pending fines</p><h2>${pendingFines}</h2></div>
        <div class="card"><p>Active repairs</p><h2>${activeRepairs}</h2></div>
      </div>
    `;
  },

  rooms() {
    const filtered = rooms.filter(
      (room) => selectedRoomFilter === "All" ||
        roomStatus(room) === selectedRoomFilter
    );

    return `
      <div class="card">
        <h3>Room management</h3>
        <div class="filters">
          ${["All", "Available", "Occupied", "Full", "Maintenance"].map(
            (filter) => `
              <button type="button" data-room-filter="${esc(filter)}"
                class="${selectedRoomFilter === filter ? "active" : ""}">
                ${esc(filter)}
              </button>
            `
          ).join("")}
        </div>

        <div class="scroll">
          <table>
            <thead><tr>
              <th>Room ID</th><th>Block</th><th>Capacity</th>
              <th>Occupied</th><th>Available beds</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${filtered.map((room) => `
                <tr>
                  <td>${esc(room.no)}</td>
                  <td>${esc(room.hostel)}</td>
                  <td>${room.cap}</td>
                  <td>${room.occ}</td>
                  <td>${Math.max(0, room.cap - room.occ)}</td>
                  <td>${badge(roomStatus(room))}</td>
                </tr>
              `).join("") || '<tr><td colspan="6">No rooms found.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  students() {
    return `
      <div class="card">
        <h3>Register a student</h3>
        <form id="student-form">
          <div class="form">
            <label>Student number *
              <input name="student_number" required maxlength="30">
            </label>
            <label>Full name *
              <input name="full_name" required maxlength="120">
            </label>
            <label>Email *
              <input name="email" type="email" required maxlength="150">
            </label>
            <label>Phone number
              <input name="phone" type="tel" maxlength="30">
            </label>
            <label>Assign room *
              <select id="student-room" name="room_id" required>
                <option value="">Select an available room</option>
              </select>
            </label>
          </div>
          <button class="btn" type="submit">Register student</button>
        </form>
      </div>

      <div class="card">
        <h3>Registered students</h3>
        <div class="scroll">
          <table>
            <thead><tr>
              <th>Student number</th><th>Full name</th><th>Email</th>
              <th>Phone</th><th>Assigned room</th>
            </tr></thead>
            <tbody id="students-table-body"></tbody>
          </table>
        </div>
      </div>
    `;
  },

  inspections() {
    return `
      <div class="card">
        <h3>Room inspection</h3>
        <p>Record hostel property conditions during check-in and check-out.</p>

        <form id="inspection-form">
          <div class="form">
            <label>Room *
              <select name="room" required>
                <option value="">Select room</option>${roomOptions(true)}
              </select>
            </label>
            <label>Inspection type *
              <select name="type" required>
                <option value="Check-in">Check-in</option>
                <option value="Check-out">Check-out</option>
              </select>
            </label>
            <label>Student number *
              <input name="student" required>
            </label>
          </div>

          <h3>Property condition</h3>
          <div class="scroll">
            <table>
              <thead><tr><th>Item</th><th>Condition</th><th>Notes</th></tr></thead>
              <tbody>
                ${ITEMS.map((item, index) => `
                  <tr>
                    <td>${esc(item)}</td>
                    <td>
                      <select name="condition_${index}">
                        ${conditionOptions()}
                      </select>
                    </td>
                    <td><input name="note_${index}" placeholder="Optional notes"></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
          <button class="btn" type="submit">Save inspection</button>
        </form>
      </div>

      <div class="card">
        <h3>Inspection history</h3>
        <div class="scroll">
          <table>
            <thead><tr>
              <th>Inspection ID</th><th>Room</th><th>Type</th>
              <th>Student</th><th>Date</th><th>Items needing attention</th>
            </tr></thead>
            <tbody>
              ${inspections.slice().reverse().map((inspection) => `
                <tr>
                  <td>${esc(inspection.id)}</td>
                  <td>${esc(inspection.room)}</td>
                  <td>${esc(inspection.type)}</td>
                  <td>${esc(inspection.student)}</td>
                  <td>${esc(inspection.date)}</td>
                  <td>${inspection.items.filter(
                    (item) => item.condition !== "Good"
                  ).length}</td>
                </tr>
              `).join("") ||
                '<tr><td colspan="6">No inspections recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     DAMAGE REPORTS
  ======================================================= */

  damage() {
    return `
      <div class="card">
        <h3>Report damaged property</h3>
        <form id="damage-form">
          <div class="form">
            <label>Room *
              <select name="room" required>
                <option value="">Select room</option>${roomOptions(true)}
              </select>
            </label>
            <label>Item *
              <select name="item" required>${itemOptions()}</select>
            </label>
            <label>Student number *
              <input name="student" required>
            </label>
            <label>Estimated fine (RM) *
              <input name="cost" type="number" min="0" step="0.01" required>
            </label>
          </div>
          <label>Description *
            <textarea name="description" required></textarea>
          </label>
          <button class="btn" type="submit">Create damage report</button>
        </form>
      </div>

      <div class="card">
        <h3>Damage reports and fines</h3>
        <div class="scroll">
          <table>
            <thead><tr>
              <th>ID</th><th>Room</th><th>Item</th><th>Student</th>
              <th>Description</th><th>Fine (RM)</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${damages.slice().reverse().map((damage) => {
                const locked = damage.status === "Paid";

                return `
                  <tr>
                    <td>${esc(damage.id)}</td>
                    <td>${esc(damage.room)}</td>
                    <td>${esc(damage.item)}</td>
                    <td>${esc(damage.student)}</td>
                    <td>${esc(damage.description)}</td>
                    <td>${damage.cost.toFixed(2)}</td>
                    <td>${badge(damage.status)}</td>
                    <td>
                      <select data-fine-status="${esc(damage.dbId)}"
                        ${locked ? "disabled" : ""}>
                        ${FINE_FLOW.map((status) => `
                          <option value="${esc(status)}"
                            ${status === damage.status ? "selected" : ""}>
                            ${esc(status)}
                          </option>
                        `).join("")}
                      </select>
                      ${
                        locked
                          ? '<span class="badge good">Locked</span>'
                          : `<button type="button" data-dispute="${esc(damage.id)}">Dispute</button>`
                      }
                    </td>
                  </tr>
                `;
              }).join("") ||
                '<tr><td colspan="8">No damage reports recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     REPAIR REQUESTS — COMPLETED REQUESTS ARE LOCKED
  ======================================================= */

  repairs() {
    return `
      <div class="card">
        <h3>Create repair request</h3>
        <form id="repair-form">
          <div class="form">
            <label>Room *
              <select name="room" required>
                <option value="">Select room</option>${roomOptions(true)}
              </select>
            </label>
            <label>Item *
              <select name="item" required>${itemOptions()}</select>
            </label>
            <label>Priority *
              <select name="priority" required>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label>Description *
            <textarea name="description" required></textarea>
          </label>
          <button class="btn" type="submit">Create repair request</button>
        </form>
      </div>

      <div class="card">
        <h3>Repair requests</h3>
        <div class="scroll">
          <table>
            <thead><tr>
              <th>ID</th><th>Room</th><th>Item</th><th>Description</th>
              <th>Priority</th><th>Status</th><th>Update status</th>
            </tr></thead>
            <tbody>
              ${repairs.slice().reverse().map((repair) => {
                const locked = repair.status === "Completed";

                return `
                  <tr>
                    <td>${esc(repair.id)}</td>
                    <td>${esc(repair.room)}</td>
                    <td>${esc(repair.item)}</td>
                    <td>${esc(repair.description)}</td>
                    <td>${badge(repair.priority)}</td>
                    <td>${badge(repair.status)}</td>
                    <td>
                      <select data-repair-status="${esc(repair.dbId)}"
                        ${locked ? "disabled" : ""}>
                        ${REPAIR_FLOW.map((status) => `
                          <option value="${esc(status)}"
                            ${status === repair.status ? "selected" : ""}>
                            ${esc(status)}
                          </option>
                        `).join("")}
                      </select>
                      ${locked ? '<span class="badge good">Locked</span>' : ""}
                    </td>
                  </tr>
                `;
              }).join("") ||
                '<tr><td colspan="7">No repair requests recorded.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};

/* =========================================================
   RENDER AND NAVIGATION
========================================================= */

const pageTitles = {
  dashboard: "Dashboard",
  rooms: "Rooms",
  students: "Student Management",
  inspections: "Inspections",
  damage: "Damage and fines",
  repairs: "Repairs"
};

function render(name) {
  if (!views[name]) name = "dashboard";

  titleElement.textContent = pageTitles[name] || name;
  view.dataset.name = name;
  view.innerHTML = views[name]();

  nav.querySelectorAll("button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "students") {
    populateStudentRooms();
    renderStudentsTable();
  }
}

/* =========================================================
   SAVE INSPECTION
========================================================= */

async function saveInspection(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const roomId = String(data.get("room") || "");
  const parts = roomId.split("-");
  const type = String(data.get("type") || "");
  const studentNumber = String(data.get("student") || "").trim();
  const student = getStudent(studentNumber);

  if (parts.length !== 3 || !getRoom(roomId)) {
    toast("Please select a valid room.");
    return;
  }

  if (!["Check-in", "Check-out"].includes(type)) {
    toast("Please select a valid inspection type.");
    return;
  }

  if (!student) {
    toast("This student number is not registered.");
    return;
  }

  if (
    String(student.room_block).trim() !== parts[0] ||
    Number(student.room_floor) !== Number(parts[1]) ||
    Number(student.room_number) !== Number(parts[2])
  ) {
    toast("The student is not assigned to this room.");
    return;
  }

  const items = ITEMS.map((item, index) => ({
    item,
    condition: String(data.get(`condition_${index}`) || "Good"),
    note: String(data.get(`note_${index}`) || "").trim()
  }));

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        student_number: studentNumber,
        inspection_type: type,
        inspection_items: items
      })
    });

    toast(result.message || "Inspection saved.");
    form.reset();
    await loadInspections();
    render("inspections");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   CREATE DAMAGE REPORT
========================================================= */

async function createDamageReport(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const parts = String(data.get("room") || "").split("-");
  const item = String(data.get("item") || "");
  const studentNumber = String(data.get("student") || "").trim();
  const description = String(data.get("description") || "").trim();
  const rawFine = String(data.get("cost") ?? "").trim();
  const student = getStudent(studentNumber);

  if (parts.length !== 3 || !getRoom(parts.join("-"))) {
    toast("Please select a valid room.");
    return;
  }

  if (!ITEMS.includes(item)) {
    toast("Please select a valid item.");
    return;
  }

  if (!student) {
    toast("This student number is not registered.");
    return;
  }

  if (
    String(student.room_block).trim() !== parts[0] ||
    Number(student.room_floor) !== Number(parts[1]) ||
    Number(student.room_number) !== Number(parts[2])
  ) {
    toast("The student is not assigned to this room.");
    return;
  }

  const fineAmount = Number(rawFine);

  if (!description || rawFine === "" ||
      !Number.isFinite(fineAmount) || fineAmount < 0) {
    toast("Enter a description and a valid fine amount.");
    return;
  }

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/damages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        item_name: item,
        student_number: studentNumber,
        description,
        fine_amount: fineAmount
      })
    });

    toast(result.message || "Damage report created.");
    form.reset();
    await loadDamages();
    render("damage");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   CREATE REPAIR REQUEST
========================================================= */

async function createRepair(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const parts = String(data.get("room") || "").split("-");
  const item = String(data.get("item") || "");
  const description = String(data.get("description") || "").trim();
  const priority = String(data.get("priority") || "Normal");

  if (parts.length !== 3 || !getRoom(parts.join("-"))) {
    toast("Please select a valid room.");
    return;
  }

  if (!ITEMS.includes(item) || !description) {
    toast("Select an item and enter a description.");
    return;
  }

  if (!["Normal", "Urgent"].includes(priority)) {
    toast("Invalid repair priority.");
    return;
  }

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/repairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        item_name: item,
        description,
        priority
      })
    });

    toast(result.message || "Repair request created.");
    form.reset();
    await loadRepairs();
    render("repairs");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* =========================================================
   UPDATE FINE STATUS — PAID REPORTS CANNOT BE CHANGED
========================================================= */

async function updateFineStatus(damage, status, disputeReason = undefined) {
  if (!damage || damage.dbId == null) {
    throw new Error("Damage report not found.");
  }

  if (!FINE_FLOW.includes(status)) {
    throw new Error("Invalid fine status.");
  }

  if (damage.status === "Paid") {
    throw new Error("This report is already Paid and locked.");
  }

  const body = { status };

  if (disputeReason !== undefined) {
    body.dispute_reason = disputeReason;
  }

  const result = await apiRequest(
    `${API_BASE}/damages/${encodeURIComponent(damage.dbId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  await loadDamages();
  toast(result.message || "Fine status updated successfully.");
}

/* =========================================================
   UPDATE REPAIR STATUS — COMPLETED REQUESTS CANNOT CHANGE
========================================================= */

async function updateRepairStatus(repair, status) {
  if (!repair || repair.dbId == null) {
    throw new Error("Repair request not found.");
  }

  if (!REPAIR_FLOW.includes(status)) {
    throw new Error("Invalid repair status.");
  }

  if (repair.status === "Completed") {
    throw new Error("This repair is already Completed and locked.");
  }

  const result = await apiRequest(
    `${API_BASE}/repairs/${encodeURIComponent(repair.dbId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }
  );

  await loadRepairs();
  toast(result.message || "Repair status updated successfully.");
}

/* =========================================================
   NAVIGATION EVENTS
========================================================= */

nav.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;

  const page = button.dataset.view;
  render(page);

  if (page === "students") await loadStudents();
  if (page === "inspections") await loadInspections();
  if (page === "damage") await loadDamages();
  if (page === "repairs") await loadRepairs();
});

/* =========================================================
   CLICK EVENTS
========================================================= */

view.addEventListener("click", (event) => {
  const filterButton = event.target.closest("[data-room-filter]");

  if (filterButton) {
    selectedRoomFilter = filterButton.dataset.roomFilter;
    render("rooms");
    return;
  }

  const disputeButton = event.target.closest("[data-dispute]");

  if (disputeButton) {
    const damage = damages.find(
      (item) => item.id === disputeButton.dataset.dispute
    );

    if (!damage) {
      toast("Damage report not found.");
      return;
    }

    if (damage.status === "Paid") {
      toast("Paid reports cannot be disputed.");
      return;
    }

    const reason = prompt("Enter the reason for disputing this fine:");

    if (reason && reason.trim()) {
      updateFineStatus(damage, "Under Review", reason.trim())
        .then(() => {
          if (view.dataset.name === "damage") render("damage");
        })
        .catch((error) => {
          toast(error.message || "Could not submit dispute.");
        });
    }
  }
});

/* =========================================================
   STATUS CHANGE EVENTS
========================================================= */

view.addEventListener("change", async (event) => {
  const fineSelect = event.target.closest("[data-fine-status]");

  if (fineSelect) {
    const damage = damages.find(
      (item) => String(item.dbId) === String(fineSelect.dataset.fineStatus)
    );

    if (!damage || damage.status === "Paid") {
      toast("This report cannot be changed.");
      render("damage");
      return;
    }

    const selectedStatus = fineSelect.value;
    fineSelect.disabled = true;

    try {
      await updateFineStatus(damage, selectedStatus);
    } catch (error) {
      console.error(error);
      toast(error.message || "Could not update fine status.");
    } finally {
      await loadDamages();
      if (view.dataset.name === "damage") render("damage");
    }

    return;
  }

  const repairSelect = event.target.closest("[data-repair-status]");

  if (repairSelect) {
    const repair = repairs.find(
      (item) => String(item.dbId) === String(repairSelect.dataset.repairStatus)
    );

    if (!repair || repair.status === "Completed") {
      toast("This repair is already Completed and locked.");
      render("repairs");
      return;
    }

    const selectedStatus = repairSelect.value;
    repairSelect.disabled = true;

    try {
      await updateRepairStatus(repair, selectedStatus);
    } catch (error) {
      console.error(error);
      toast(error.message || "Could not update repair status.");
    } finally {
      await loadRepairs();
      if (view.dataset.name === "repairs") render("repairs");
    }
  }
});

/* =========================================================
   FORM SUBMISSION EVENTS
========================================================= */

view.addEventListener("submit", (event) => {
  const form = event.target;

  if (!(form instanceof HTMLFormElement)) return;

  if ([
    "student-form",
    "inspection-form",
    "damage-form",
    "repair-form"
  ].includes(form.id)) {
    event.preventDefault();
  }

  if (form.id === "student-form") {
    registerStudent(event);
  } else if (form.id === "inspection-form") {
    saveInspection(event);
  } else if (form.id === "damage-form") {
    createDamageReport(event);
  } else if (form.id === "repair-form") {
    createRepair(event);
  }
});

/* =========================================================
   INITIALIZE APPLICATION
========================================================= */

if ($("#today")) {
  $("#today").textContent = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

render("dashboard");

loadRoomsFromDatabase();
loadStudents();
loadInspections();
loadDamages();
loadRepairs();
