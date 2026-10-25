
const ITEMS = [
  "Bed",
  "Mattress",
  "Desk",
  "Chair",
  "Wardrobe",
  "Ceiling fan",
  "Tube light",
  "Window",
  "Sink"
];

const CONDITIONS = ["Good", "Damaged", "Broken"];
const FINE_FLOW = ["Pending", "Under Review", "Approved", "Paid"];
const REPAIR_FLOW = ["Reported", "Assigned", "In Progress", "Completed"];

// Rooms are loaded from PostgreSQL through the Node.js backend.
let rooms = [];

let damages = [
  {
    id: "D-001",
    room: "B-204",
    item: "Mattress",
    student: "20260045",
    cost: 80,
    status: "Pending"
  },
  {
    id: "D-002",
    room: "A-101",
    item: "Chair",
    student: "20260012",
    cost: 35,
    status: "Approved"
  },
  {
    id: "D-003",
    room: "A-102",
    item: "Mirror",
    student: "20260031",
    cost: 25,
    status: "Paid"
  }
];

let repairs = [
  {
    id: "R-001",
    room: "A-102",
    issue: "Ceiling fan not working",
    priority: "Normal",
    status: "Reported"
  },
  {
    id: "R-002",
    room: "B-204",
    issue: "Water leak near sink",
    priority: "Urgent",
    status: "In Progress"
  }
];

let inspections = [];

const $ = (s) => document.querySelector(s);
const view = $("#view");

const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

const roomStatus = (r) =>
  r.fix
    ? "Under Maintenance"
    : r.occ === 0
      ? "Available"
      : r.occ < r.cap
        ? "Partially Occupied"
        : "Full";

const tone = (s) => ({
  "Available": "green",
  "Paid": "green",
  "Completed": "green",
  "Approved": "",
  "Partially Occupied": "amber",
  "Pending": "amber",
  "Under Review": "amber",
  "Reported": "amber",
  "Assigned": "",
  "In Progress": "",
  "Under Maintenance": "red",
  "Urgent": "red",
  "Disputed": "red"
}[s] ?? "");

const badge = (s) =>
  `<span class="badge ${tone(s)}">${esc(s)}</span>`;

function toast(msg) {
  const t = $("#toast");

  if (!t) {
    console.log(msg);
    return;
  }

  t.textContent = msg;
  t.classList.add("show");

  setTimeout(() => t.classList.remove("show"), 2200);
}

// Load rooms from the Node.js backend.
async function loadRoomsFromDatabase() {
  try {
    const response = await fetch("http://localhost:3000/api/rooms");

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const data = await response.json();

    rooms = data.map((r) => ({
      no: r.room_id,
      hostel: `Block ${r.block}`,
      cap: Number(r.capacity),
      occ: Number(r.occupied),
      fix: r.under_maintenance
    }));

    console.log("Rooms loaded from PostgreSQL:", rooms);

    // Refresh the currently displayed page using the latest room data.
    render(view.dataset.name || "dashboard");

  } catch (error) {
    console.error("Could not load rooms:", error);
    toast("Could not load rooms. Check the backend.");
  }
}

const views = {
  dashboard() {
    const totalBeds = rooms.reduce((a, r) => a + r.cap, 0);
    const used = rooms.reduce((a, r) => a + r.occ, 0);

    const unpaid = damages
      .filter((d) => d.status !== "Paid")
      .reduce((a, d) => a + d.cost, 0);

    const open = repairs.filter(
      (r) => r.status !== "Completed"
    ).length;

    const counts = {};

    damages.forEach((d) => {
      counts[d.item] = (counts[d.item] || 0) + 1;
    });

    const max = Math.max(1, ...Object.values(counts));

    return `
      <div class="stats">
        <div class="stat">
          <b>${used}/${totalBeds}</b>
          <span>Beds occupied</span>
        </div>

        <div class="stat">
          <b>${damages.length}</b>
          <span>Damage reports</span>
        </div>

        <div class="stat">
          <b>${open}</b>
          <span>Open repairs</span>
        </div>

        <div class="stat warn">
          <b>RM ${unpaid}</b>
          <span>Unpaid fines</span>
        </div>
      </div>

      <div class="cols">
        <div class="card">
          <h3>Most damaged items</h3>

          ${
            Object.entries(counts).map(([k, v]) => `
              <div class="bar">
                <span>${esc(k)}</span>
                <i style="width:${(v / max) * 100}%"></i>
                <b>${v}</b>
              </div>
            `).join("") ||
            '<p class="empty">No damage yet.</p>'
          }
        </div>

        <div class="card">
          <h3>Latest repair requests</h3>

          <table>
            <tbody>
              ${
                repairs.slice(-4).reverse().map((r) => `
                  <tr>
                    <td>${esc(r.room)}</td>
                    <td>${esc(r.issue)}</td>
                    <td>${badge(r.status)}</td>
                  </tr>
                `).join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  rooms() {
    const f = views._filter || "All";

    const list = rooms.filter(
      (r) => f === "All" || roomStatus(r) === f
    );

    const opts = [
      "All",
      "Available",
      "Partially Occupied",
      "Full",
      "Under Maintenance"
    ];

    return `
      <div class="card">
        <div class="filters">
          ${
            opts.map((o) => `
              <button
                class="btn small ${o === f ? "" : "ghost"}"
                data-filter="${o}"
              >
                ${o}
              </button>
            `).join("")
          }
        </div>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Hostel</th>
                <th class="num">Capacity</th>
                <th class="num">Occupied</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              ${
                list.map((r) => `
                  <tr>
                    <td><b>${esc(r.no)}</b></td>
                    <td>${esc(r.hostel)}</td>
                    <td class="num">${r.cap}</td>
                    <td class="num">${r.occ}</td>
                    <td>${badge(roomStatus(r))}</td>
                  </tr>
                `).join("") ||
                '<tr><td colspan="5" class="empty">No rooms match this filter.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  inspections() {
    return `
      <div class="card">
        <h3>New inspection</h3>

        <div class="form">
          <label>
            Room
            <select id="i-room">
              ${
                rooms.map((r) => `
                  <option value="${esc(r.no)}">${esc(r.no)}</option>
                `).join("")
              }
            </select>
          </label>

          <label>
            Type
            <select id="i-type">
              <option>Check-in</option>
              <option>Check-out</option>
            </select>
          </label>

          <label>
            Student ID
            <input id="i-student" placeholder="20260045">
          </label>
        </div>

        <div class="items">
          ${
            ITEMS.map((n, i) => `
              <label>
                ${esc(n)}
                <select data-item="${i}">
                  ${
                    CONDITIONS.map((c) => `
                      <option>${esc(c)}</option>
                    `).join("")
                  }
                </select>
              </label>
            `).join("")
          }
        </div>

        <button class="btn" id="save-insp">Save inspection</button>
        <div id="compare" style="margin-top:16px"></div>
      </div>

      <div class="card">
        <h3>Saved inspections</h3>

        <table>
          <thead>
            <tr>
              <th>Room</th>
              <th>Type</th>
              <th>Student</th>
              <th>Date</th>
              <th>Items not good</th>
            </tr>
          </thead>

          <tbody>
            ${
              inspections.slice().reverse().map((x) => `
                <tr>
                  <td>${esc(x.room)}</td>
                  <td>${badge(x.type)}</td>
                  <td>${esc(x.student || "-")}</td>
                  <td>${esc(x.date)}</td>
                  <td>
                    ${
                      x.bad.length
                        ? esc(x.bad.map((b) => `${b.item} (${b.cond})`).join(", "))
                        : "None"
                    }
                  </td>
                </tr>
              `).join("") ||
              '<tr><td colspan="5" class="empty">No inspections yet. Save a check-in to start.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  },

  damage() {
    return `
      <div class="card scroll">
        <h3>Damage reports and fines</h3>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Room</th>
              <th>Item</th>
              <th>Student</th>
              <th class="num">Fine (RM)</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${
              damages.map((d, i) => {
                const next =
                  FINE_FLOW[FINE_FLOW.indexOf(d.status) + 1];

                return `
                  <tr>
                    <td>${esc(d.id)}</td>
                    <td>${esc(d.room)}</td>
                    <td>${esc(d.item)}</td>
                    <td>${esc(d.student)}</td>
                    <td class="num">${d.cost}</td>
                    <td>${badge(d.status)}</td>

                    <td>
                      ${
                        next
                          ? `<button class="btn small" data-fine="${i}">Mark ${next}</button>`
                          : ""
                      }

                      ${
                        d.status !== "Paid" && d.status !== "Disputed"
                          ? `<button class="btn small ghost" data-dispute="${i}">Dispute</button>`
                          : ""
                      }
                    </td>
                  </tr>
                `;
              }).join("") ||
              '<tr><td colspan="7" class="empty">No damage reports.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  },

  repairs() {
    return `
      <div class="card">
        <h3>Report a problem</h3>

        <div class="form">
          <label>
            Room
            <select id="r-room">
              ${
                rooms.map((r) => `
                  <option value="${esc(r.no)}">${esc(r.no)}</option>
                `).join("")
              }
            </select>
          </label>

          <label>
            Problem
            <input id="r-issue" placeholder="e.g. Tube light broken">
          </label>

          <label>
            Priority
            <select id="r-pri">
              <option>Low</option>
              <option selected>Normal</option>
              <option>Urgent</option>
            </select>
          </label>

          <button class="btn" id="add-repair">Send request</button>
        </div>
      </div>

      <div class="card scroll">
        <h3>Repair requests</h3>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Room</th>
              <th>Problem</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${
              repairs.map((r, i) => {
                const next =
                  REPAIR_FLOW[REPAIR_FLOW.indexOf(r.status) + 1];

                return `
                  <tr>
                    <td>${esc(r.id)}</td>
                    <td>${esc(r.room)}</td>
                    <td>${esc(r.issue)}</td>
                    <td>${badge(r.priority)}</td>
                    <td>${badge(r.status)}</td>
                    <td>
                      ${
                        next
                          ? `<button class="btn small" data-repair="${i}">Mark ${next}</button>`
                          : ""
                      }
                    </td>
                  </tr>
                `;
              }).join("")
            }
          </tbody>
        </table>
      </div>
    `;
  }
};

function render(name) {
  const titles = {
    dashboard: "Dashboard",
    rooms: "Rooms",
    inspections: "Inspections",
    damage: "Damage and fines",
    repairs: "Repairs"
  };

  if (!views[name]) {
    name = "dashboard";
  }

  $("#title").textContent = titles[name];

  document.querySelectorAll("#nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  view.dataset.name = name;
  view.innerHTML = views[name]();
}

function saveInspection() {
  const room = $("#i-room").value;
  const type = $("#i-type").value;
  const student = $("#i-student").value.trim();

  const bad = [...document.querySelectorAll("[data-item]")]
    .map((s) => ({
      item: ITEMS[Number(s.dataset.item)],
      cond: s.value
    }))
    .filter((x) => x.cond !== "Good");

  const rec = {
    room,
    type,
    student,
    bad,
    date: new Date().toISOString().slice(0, 10)
  };

  const lastIn = inspections
    .filter((x) => x.room === room && x.type === "Check-in")
    .pop();

  inspections.push(rec);

  toast(type + " saved for " + room);
  render("inspections");

  if (type === "Check-out" && lastIn) {
    const before = new Set(lastIn.bad.map((b) => b.item));
    const fresh = bad.filter((b) => !before.has(b.item));

    $("#compare").innerHTML = fresh.length
      ? `
        <div class="notice">
          <b>New damage found:</b>
          ${esc(fresh.map((f) => `${f.item} (${f.cond})`).join(", "))}.
          <button class="btn small" id="make-damage">
            Create damage reports
          </button>
        </div>
      `
      : `
        <div class="notice" style="background:var(--green-l);color:var(--green)">
          No new damage since check-in.
        </div>
      `;

    window._fresh = { room, student, fresh };
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;

  const navButton = t.closest("#nav button");

  if (navButton) {
    render(navButton.dataset.view);
    return;
  }

  if (t.dataset.filter) {
    views._filter = t.dataset.filter;
    render("rooms");
    return;
  }

  if (t.id === "save-insp") {
    saveInspection();
    return;
  }

  if (t.id === "make-damage") {
    const data = window._fresh;

    if (!data) return;

    const { room, student, fresh } = data;

    fresh.forEach((f) => {
      damages.push({
        id: "D-" + String(damages.length + 1).padStart(3, "0"),
        room,
        item: f.item,
        student: student || "-",
        cost: 30,
        status: "Pending"
      });
    });

    toast("Damage reports created");
    render("damage");
    return;
  }

  if (t.dataset.fine !== undefined) {
    const d = damages[Number(t.dataset.fine)];
    const next = FINE_FLOW[FINE_FLOW.indexOf(d.status) + 1];

    if (next) {
      d.status = next;
      toast("Fine marked " + d.status);
      render("damage");
    }

    return;
  }

  if (t.dataset.dispute !== undefined) {
    damages[Number(t.dataset.dispute)].status = "Disputed";
    toast("Fine disputed");
    render("damage");
    return;
  }

  if (t.dataset.repair !== undefined) {
    const r = repairs[Number(t.dataset.repair)];
    const next = REPAIR_FLOW[REPAIR_FLOW.indexOf(r.status) + 1];

    if (next) {
      r.status = next;
      toast("Request marked " + r.status);
      render("repairs");
    }

    return;
  }

  if (t.id === "add-repair") {
    const issue = $("#r-issue").value.trim();

    if (!issue) {
      toast("Describe the problem first");
      $("#r-issue").focus();
      return;
    }

    repairs.push({
      id: "R-" + String(repairs.length + 1).padStart(3, "0"),
      room: $("#r-room").value,
      issue,
      priority: $("#r-pri").value,
      status: "Reported"
    });

    toast("Request sent");
    render("repairs");
  }
});

$("#today").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});

render("dashboard");
loadRoomsFromDatabase();
