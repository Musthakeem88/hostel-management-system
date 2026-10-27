
/* =========================================================
   HOSTEL MANAGEMENT SYSTEM
   Main/JS/script.js

   Frontend:
   HTML, CSS, Bootstrap-compatible classes, JavaScript

   Backend APIs:
   GET  /api/rooms
   GET  /api/students
   POST /api/students

   Note:
   Students and rooms use PostgreSQL.
   Inspections, damages, fines and repairs currently use
   browser memory and reset when the page is refreshed.
========================================================= */

const API_BASE = "/api";

const $ = (selector) => document.querySelector(selector);

const view = $("#view");
const titleElement = $("#title");
const nav = $("#nav");
const toastElement = $("#toast");

const ITEMS = [
  "Bed",
  "Mattress",
  "Desk",
  "Chair",
  "Wardrobe",
  "Ceiling fan",
  "Tube light",
  "Window",
  "Sink",
  "Mirror"
];

const CONDITIONS = ["Good", "Damaged", "Broken"];
const FINE_FLOW = ["Pending", "Under Review", "Approved", "Paid"];
const REPAIR_FLOW = ["Reported", "Assigned", "In Progress", "Completed"];

/* =========================================================
   APPLICATION DATA
========================================================= */

let rooms = [];
let students = [];

let damages = [
  {
    id: "D-001",
    room: "B-02-04",
    item: "Mattress",
    student: "20260045",
    description: "Mattress damaged",
    cost: 80,
    status: "Pending"
  },
  {
    id: "D-002",
    room: "A-01-01",
    item: "Chair",
    student: "20260012",
    description: "Chair damaged",
    cost: 35,
    status: "Approved"
  },
  {
    id: "D-003",
    room: "A-01-02",
    item: "Mirror",
    student: "20260031",
    description: "Mirror broken",
    cost: 25,
    status: "Paid"
  }
];

let repairs = [
  {
    id: "R-001",
    room: "A-01-02",
    item: "Ceiling fan",
    description: "Ceiling fan not working",
    priority: "Normal",
    status: "Reported"
  },
  {
    id: "R-002",
    room: "B-02-04",
    item: "Sink",
    description: "Water leak near sink",
    priority: "Urgent",
    status: "In Progress"
  }
];

let inspections = [];

let selectedRoomFilter = "All";

/* =========================================================
   HELPER FUNCTIONS
========================================================= */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
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

  if (
    value === "paid" ||
    value === "completed" ||
    value === "good" ||
    value === "available"
  ) {
    return "good";
  }

  if (
    value === "broken" ||
    value === "urgent" ||
    value === "maintenance"
  ) {
    return "bad";
  }

  if (
    value === "pending" ||
    value === "damaged" ||
    value === "reported" ||
    value === "under review"
  ) {
    return "warn";
  }

  return "info";
}

function badge(status) {
  return `<span class="badge ${tone(status)}">${esc(status)}</span>`;
}

function makeRoomLabel(room) {
  return `${room.no} (${room.occ}/${room.cap})`;
}

function roomOptions(includeUnavailable = false) {
  return rooms
    .filter((room) => {
      if (includeUnavailable) return true;

      return !room.fix && Number(room.occ) < Number(room.cap);
    })
    .map((room) => `
      <option value="${esc(room.no)}">
        ${esc(makeRoomLabel(room))}
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
    (student) => student.student_number === studentNumber
  );
}

function getRoomStudentCount(roomId) {
  return students.filter((student) => {
    const room = getRoom(roomId);

    return room &&
      student.room_block === room.no.split("-")[0] &&
      Number(student.room_floor) === Number(room.no.split("-")[1]) &&
      Number(student.room_number) === Number(room.no.split("-")[2]);
  }).length;
}

function nextId(prefix, collection) {
  const number = collection.length + 1;
  return `${prefix}-${String(number).padStart(3, "0")}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }

  return data;
}

/* =========================================================
   LOAD ROOMS FROM POSTGRESQL
========================================================= */

async function loadRoomsFromDatabase() {
  try {
    const data = await apiRequest(`${API_BASE}/rooms`);

    const rows = Array.isArray(data) ? data : data.rooms;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected room data received from the server.");
    }

    rooms = rows.map((room) => ({
      no: room.room_id ||
        `${room.block}-${String(room.floor).padStart(2, "0")}-${String(room.room_number).padStart(2, "0")}`,
      hostel: `Block ${room.block}`,
      cap: Number(room.capacity),
      occ: Number(room.occupied),
      fix: room.under_maintenance === true
    }));

    populateStudentRooms();

    if (view.dataset.name) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error("Could not load rooms:", error);
    toast("Could not load rooms. Check the backend server.");
  }
}

/* =========================================================
   LOAD STUDENTS FROM POSTGRESQL
========================================================= */

async function loadStudents() {
  try {
    const data = await apiRequest(`${API_BASE}/students`);

    students = Array.isArray(data) ? data : data.students;

    if (!Array.isArray(students)) {
      throw new Error("Unexpected student data received from the server.");
    }

    if (view.dataset.name === "students") {
      renderStudentsTable();
    }

    if (view.dataset.name === "dashboard") {
      render("dashboard");
    }
  } catch (error) {
    console.error("Could not load students:", error);
    toast("Could not load students. Check /api/students.");
  }
}

/* =========================================================
   STUDENT ROOM SELECTOR
========================================================= */

function populateStudentRooms() {
  const select = $("#student-room");

  if (!select) return;

  const previousValue = select.value;

  const availableRooms = rooms.filter((room) => {
    return !room.fix && Number(room.occ) < Number(room.cap);
  });

  select.innerHTML =
    '<option value="">Select an available room</option>' +
    availableRooms.map((room) => `
      <option value="${esc(room.no)}">
        ${esc(room.no)} — ${Number(room.cap) - Number(room.occ)} bed(s) available
      </option>
    `).join("");

  if (availableRooms.some((room) => room.no === previousValue)) {
    select.value = previousValue;
  }
}

/* =========================================================
   STUDENT TABLE
========================================================= */

function renderStudentsTable() {
  const tbody = $("#students-table-body");

  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5">No students registered yet.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = students.map((student) => `
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
  `).join("");
}

/* =========================================================
   REGISTER STUDENT
========================================================= */

async function registerStudent(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const formData = new FormData(form);
  const roomId = formData.get("room_id");

  const room = getRoom(roomId);

  if (!room) {
    toast("Please select an available room.");
    return;
  }

  if (room.fix || Number(room.occ) >= Number(room.cap)) {
    toast("This room is full or under maintenance. Choose another room.");
    await loadRoomsFromDatabase();
    return;
  }

  const parts = roomId.split("-");

  if (parts.length !== 3) {
    toast("The room ID format is invalid.");
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Registering...";
  }

  try {
    const result = await apiRequest(`${API_BASE}/students`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        student_number: formData.get("student_number"),
        full_name: formData.get("full_name"),
        email: formData.get("email"),
        phone: formData.get("phone"),
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
    console.error("Student registration failed:", error);
    toast(error.message);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Register student";
    }
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

const views = {
  dashboard() {
    const available = rooms.filter(
      (room) => !room.fix && Number(room.occ) < Number(room.cap)
    ).length;

    const full = rooms.filter(
      (room) => Number(room.occ) >= Number(room.cap)
    ).length;

    const maintenance = rooms.filter((room) => room.fix).length;

    const pendingFines = damages.filter(
      (damage) => damage.status === "Pending"
    ).length;

    const activeRepairs = repairs.filter(
      (repair) => repair.status !== "Completed"
    ).length;

    const totalCapacity = rooms.reduce(
      (sum, room) => sum + Number(room.cap),
      0
    );

    const totalOccupied = rooms.reduce(
      (sum, room) => sum + Number(room.occ),
      0
    );

    const recentRepairs = repairs.slice(-5).reverse();

    const damagedItems = {};

    damages.forEach((damage) => {
      damagedItems[damage.item] = (damagedItems[damage.item] || 0) + 1;
    });

    const topDamagedItems = Object.entries(damagedItems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return `
      <div class="stats">
        <div class="card">
          <p>Total rooms</p>
          <h2>${rooms.length}</h2>
        </div>

        <div class="card">
          <p>Registered students</p>
          <h2>${students.length}</h2>
        </div>

        <div class="card">
          <p>Available rooms</p>
          <h2>${available}</h2>
        </div>

        <div class="card">
          <p>Full rooms</p>
          <h2>${full}</h2>
        </div>

        <div class="card">
          <p>Maintenance rooms</p>
          <h2>${maintenance}</h2>
        </div>

        <div class="card">
          <p>Occupied beds</p>
          <h2>${totalOccupied} / ${totalCapacity}</h2>
        </div>

        <div class="card">
          <p>Pending fines</p>
          <h2>${pendingFines}</h2>
        </div>

        <div class="card">
          <p>Active repairs</p>
          <h2>${activeRepairs}</h2>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h3>Most reported damaged items</h3>

          ${
            topDamagedItems.length
              ? `<ul>
                  ${topDamagedItems.map(([item, count]) => `
                    <li>${esc(item)} — ${count} report(s)</li>
                  `).join("")}
                </ul>`
              : "<p>No damage reports yet.</p>"
          }
        </div>

        <div class="card">
          <h3>Recent repairs</h3>

          ${
            recentRepairs.length
              ? `<ul>
                  ${recentRepairs.map((repair) => `
                    <li>
                      ${esc(repair.id)} — ${esc(repair.room)} —
                      ${esc(repair.item)} ${badge(repair.status)}
                    </li>
                  `).join("")}
                </ul>`
              : "<p>No repair requests yet.</p>"
          }
        </div>
      </div>
    `;
  },

  /* =======================================================
     ROOMS
  ======================================================= */

  rooms() {
    const filteredRooms = rooms.filter((room) => {
      if (selectedRoomFilter === "All") return true;
      return roomStatus(room) === selectedRoomFilter;
    });

    return `
      <div class="card">
        <h3>Room management</h3>

        <div class="filters">
          ${["All", "Available", "Occupied", "Full", "Maintenance"].map(
            (filter) => `
              <button
                type="button"
                data-room-filter="${esc(filter)}"
                class="${selectedRoomFilter === filter ? "active" : ""}"
              >
                ${esc(filter)}
              </button>
            `
          ).join("")}
        </div>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Room ID</th>
                <th>Block</th>
                <th>Capacity</th>
                <th>Occupied</th>
                <th>Available beds</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              ${
                filteredRooms.length
                  ? filteredRooms.map((room) => `
                      <tr>
                        <td>${esc(room.no)}</td>
                        <td>${esc(room.hostel)}</td>
                        <td>${room.cap}</td>
                        <td>${room.occ}</td>
                        <td>${Math.max(0, room.cap - room.occ)}</td>
                        <td>${badge(roomStatus(room))}</td>
                      </tr>
                    `).join("")
                  : '<tr><td colspan="6">No rooms found.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     STUDENTS
  ======================================================= */

  students() {
    return `
      <div class="card">
        <h3>Register a student</h3>

        <form id="student-form">
          <div class="form">
            <label>
              Student number *
              <input
                id="student-number"
                name="student_number"
                required
                maxlength="30"
                placeholder="e.g. 20260045"
              >
            </label>

            <label>
              Full name *
              <input
                id="student-name"
                name="full_name"
                required
                maxlength="120"
                placeholder="Enter full name"
              >
            </label>

            <label>
              Email *
              <input
                id="student-email"
                name="email"
                type="email"
                required
                maxlength="150"
                placeholder="student@example.com"
              >
            </label>

            <label>
              Phone number
              <input
                id="student-phone"
                name="phone"
                type="tel"
                maxlength="30"
                placeholder="Enter phone number"
              >
            </label>

            <label>
              Assign room *
              <select id="student-room" name="room_id" required>
                <option value="">Loading available rooms...</option>
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
            <thead>
              <tr>
                <th>Student number</th>
                <th>Full name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Assigned room</th>
              </tr>
            </thead>

            <tbody id="students-table-body">
              <tr><td colspan="5">Loading students...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     INSPECTIONS
  ======================================================= */

  inspections() {
    return `
      <div class="card">
        <h3>Room inspection</h3>

        <p>
          Record the condition of hostel property during check-in
          and check-out.
        </p>

        <form id="inspection-form">
          <div class="form">
            <label>
              Room *
              <select name="room" required>
                <option value="">Select room</option>
                ${roomOptions(true)}
              </select>
            </label>

            <label>
              Inspection type *
              <select name="type" required>
                <option value="Check-in">Check-in</option>
                <option value="Check-out">Check-out</option>
              </select>
            </label>

            <label>
              Student number *
              <input
                name="student"
                required
                placeholder="Student number"
              >
            </label>
          </div>

          <h3>Property condition</h3>

          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Condition</th>
                  <th>Notes</th>
                </tr>
              </thead>

              <tbody>
                ${ITEMS.map((item, index) => `
                  <tr>
                    <td>${esc(item)}</td>
                    <td>
                      <select name="condition_${index}">
                        ${conditionOptions()}
                      </select>
                    </td>
                    <td>
                      <input
                        name="note_${index}"
                        placeholder="Optional notes"
                      >
                    </td>
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
            <thead>
              <tr>
                <th>Inspection ID</th>
                <th>Room</th>
                <th>Type</th>
                <th>Student</th>
                <th>Date</th>
                <th>Items needing attention</th>
              </tr>
            </thead>

            <tbody>
              ${
                inspections.length
                  ? inspections.slice().reverse().map((inspection) => {
                      const issues = inspection.items.filter(
                        (item) => item.condition !== "Good"
                      ).length;

                      return `
                        <tr>
                          <td>${esc(inspection.id)}</td>
                          <td>${esc(inspection.room)}</td>
                          <td>${esc(inspection.type)}</td>
                          <td>${esc(inspection.student)}</td>
                          <td>${esc(inspection.date)}</td>
                          <td>${issues}</td>
                        </tr>
                      `;
                    }).join("")
                  : '<tr><td colspan="6">No inspections recorded.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     DAMAGE REPORTS AND FINES
  ======================================================= */

  damage() {
    return `
      <div class="card">
        <h3>Report damaged property</h3>

        <form id="damage-form">
          <div class="form">
            <label>
              Room *
              <select name="room" required>
                <option value="">Select room</option>
                ${roomOptions(true)}
              </select>
            </label>

            <label>
              Item *
              <select name="item" required>
                ${itemOptions()}
              </select>
            </label>

            <label>
              Student number *
              <input name="student" required>
            </label>

            <label>
              Estimated fine (RM) *
              <input
                name="cost"
                type="number"
                min="0"
                step="0.01"
                required
              >
            </label>
          </div>

          <label>
            Description *
            <textarea name="description" required
              placeholder="Describe the damage"></textarea>
          </label>

          <button class="btn" type="submit">Create damage report</button>
        </form>
      </div>

      <div class="card">
        <h3>Damage reports and fines</h3>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Room</th>
                <th>Item</th>
                <th>Student</th>
                <th>Description</th>
                <th>Fine (RM)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              ${
                damages.length
                  ? damages.slice().reverse().map((damage) => `
                      <tr>
                        <td>${esc(damage.id)}</td>
                        <td>${esc(damage.room)}</td>
                        <td>${esc(damage.item)}</td>
                        <td>${esc(damage.student)}</td>
                        <td>${esc(damage.description)}</td>
                        <td>${Number(damage.cost).toFixed(2)}</td>
                        <td>${badge(damage.status)}</td>
                        <td>
                          <select data-fine-status="${esc(damage.id)}">
                            ${FINE_FLOW.map((status) => `
                              <option
                                value="${esc(status)}"
                                ${status === damage.status ? "selected" : ""}
                              >${esc(status)}</option>
                            `).join("")}
                          </select>

                          <button
                            type="button"
                            data-dispute="${esc(damage.id)}"
                          >Dispute</button>
                        </td>
                      </tr>
                    `).join("")
                  : '<tr><td colspan="8">No damage reports recorded.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  /* =======================================================
     REPAIRS
  ======================================================= */

  repairs() {
    return `
      <div class="card">
        <h3>Create repair request</h3>

        <form id="repair-form">
          <div class="form">
            <label>
              Room *
              <select name="room" required>
                <option value="">Select room</option>
                ${roomOptions(true)}
              </select>
            </label>

            <label>
              Item *
              <select name="item" required>
                ${itemOptions()}
              </select>
            </label>

            <label>
              Priority *
              <select name="priority" required>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
              </select>
            </label>
          </div>

          <label>
            Description *
            <textarea name="description" required
              placeholder="Describe the problem"></textarea>
          </label>

          <button class="btn" type="submit">Create repair request</button>
        </form>
      </div>

      <div class="card">
        <h3>Repair requests</h3>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Room</th>
                <th>Item</th>
                <th>Description</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Update status</th>
              </tr>
            </thead>

            <tbody>
              ${
                repairs.length
                  ? repairs.slice().reverse().map((repair) => `
                      <tr>
                        <td>${esc(repair.id)}</td>
                        <td>${esc(repair.room)}</td>
                        <td>${esc(repair.item)}</td>
                        <td>${esc(repair.description)}</td>
                        <td>${badge(repair.priority)}</td>
                        <td>${badge(repair.status)}</td>
                        <td>
                          <select data-repair-status="${esc(repair.id)}">
                            ${REPAIR_FLOW.map((status) => `
                              <option
                                value="${esc(status)}"
                                ${status === repair.status ? "selected" : ""}
                              >${esc(status)}</option>
                            `).join("")}
                          </select>
                        </td>
                      </tr>
                    `).join("")
                  : '<tr><td colspan="7">No repair requests recorded.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};

/* =========================================================
   RENDER PAGES
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
  if (!views[name]) {
    name = "dashboard";
  }

  titleElement.textContent = pageTitles[name] || name;
  view.dataset.name = name;
  view.innerHTML = views[name]();

  nav.querySelectorAll("button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "students") {
    populateStudentRooms();
    renderStudentsTable();

    const form = $("#student-form");

    if (form) {
      form.addEventListener("submit", registerStudent);
    }
  }
}

/* =========================================================
   SAVE INSPECTION AND DETECT POSSIBLE DAMAGE
========================================================= */

function saveInspection(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const data = new FormData(form);

  const room = data.get("room");
  const type = data.get("type");
  const student = String(data.get("student") || "").trim();

  const items = ITEMS.map((item, index) => ({
    item,
    condition: data.get(`condition_${index}`),
    note: String(data.get(`note_${index}`) || "").trim()
  }));

  const inspection = {
    id: nextId("I", inspections),
    room,
    type,
    student,
    date: new Date().toLocaleString(),
    items
  };

  inspections.push(inspection);

  if (type === "Check-out") {
    const previousCheckIn = inspections
      .slice(0, -1)
      .reverse()
      .find((previous) =>
        previous.room === room &&
        previous.student === student &&
        previous.type === "Check-in"
      );

    items.forEach((item) => {
      const previousItem = previousCheckIn?.items.find(
        (entry) => entry.item === item.item
      );

      const newlyDamaged =
        item.condition !== "Good" &&
        (!previousItem || previousItem.condition === "Good");

      if (newlyDamaged) {
        damages.push({
          id: nextId("D", damages),
          room,
          item: item.item,
          student,
          description: item.note || `Damage detected during check-out: ${item.condition}`,
          cost: 0,
          status: "Pending"
        });
      }
    });
  }

  toast(
    type === "Check-out"
      ? "Check-out inspection saved. Review any new damage reports."
      : "Check-in inspection saved."
  );

  render("inspections");
}

/* =========================================================
   CREATE DAMAGE REPORT
========================================================= */

function createDamageReport(event) {
  event.preventDefault();

  const data = new FormData(event.currentTarget);

  damages.push({
    id: nextId("D", damages),
    room: data.get("room"),
    item: data.get("item"),
    student: String(data.get("student") || "").trim(),
    description: String(data.get("description") || "").trim(),
    cost: Number(data.get("cost")),
    status: "Pending"
  });

  toast("Damage report created.");
  render("damage");
}

/* =========================================================
   CREATE REPAIR REQUEST
========================================================= */

function createRepair(event) {
  event.preventDefault();

  const data = new FormData(event.currentTarget);

  repairs.push({
    id: nextId("R", repairs),
    room: data.get("room"),
    item: data.get("item"),
    description: String(data.get("description") || "").trim(),
    priority: data.get("priority"),
    status: "Reported"
  });

  toast("Repair request created.");
  render("repairs");
}

/* =========================================================
   NAVIGATION AND PAGE EVENTS
========================================================= */

nav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");

  if (!button) return;

  render(button.dataset.view);
});

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

    if (damage) {
      const reason = prompt("Enter the reason for disputing this fine:");

      if (reason && reason.trim()) {
        damage.status = "Under Review";
        damage.disputeReason = reason.trim();

        toast("Fine marked for review.");
        render("damage");
      }
    }
  }
});

view.addEventListener("change", (event) => {
  const fineSelect = event.target.closest("[data-fine-status]");

  if (fineSelect) {
    const damage = damages.find(
      (item) => item.id === fineSelect.dataset.fineStatus
    );

    if (damage) {
      damage.status = fineSelect.value;
      toast("Fine status updated.");
      render("damage");
    }

    return;
  }

  const repairSelect = event.target.closest("[data-repair-status]");

  if (repairSelect) {
    const repair = repairs.find(
      (item) => item.id === repairSelect.dataset.repairStatus
    );

    if (repair) {
      repair.status = repairSelect.value;
      toast("Repair status updated.");
      render("repairs");
    }
  }
});

view.addEventListener("submit", (event) => {
  if (event.target.id === "inspection-form") {
    saveInspection(event);
  } else if (event.target.id === "damage-form") {
    createDamageReport(event);
  } else if (event.target.id === "repair-form") {
    createRepair(event);
  }
});

/* =========================================================
   DATE AND INITIAL PAGE
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
loadDamages();
loadRepairs();