/* js/views/dashboard.js */

views.dashboard = function () {
  const available = rooms.filter(
    (room) => !room.fix && room.occ < room.cap
  ).length;

  const full = rooms.filter((room) => room.occ >= room.cap).length;
  const maintenanceRooms = rooms.filter((room) => room.fix).length;

  const pendingFines = damages.filter(
    (damage) => damage.status === "Pending"
  ).length;

  const activeRepairs = repairs.filter(
    (repair) => repair.status !== "Completed"
  ).length;

  const mCount = (status) => maintenance.filter((job) => job.status === status).length;
  const mOverdue = maintenance.filter(isOverdue).length;

  // Open jobs, soonest deadline first (jobs without a date go last)
  const openJobs = maintenance
    .filter((job) => job.status !== "Completed")
    .sort((a, b) => (a.expected || "9999-99-99").localeCompare(b.expected || "9999-99-99"));

  const openJobRows = openJobs.slice(0, 5).map((job) => `
    <tr>
      <td>${esc(job.room)}</td>
      <td>${esc(job.type)}</td>
      <td class="wrap">${esc(job.description)}</td>
      <td>${job.staff ? esc(job.staff) : '<span class="muted">Unassigned</span>'}</td>
      <td>${badge(job.status)}</td>
      <td><span class="nowrap">${formatDate(job.expected)}</span> ${isOverdue(job) ? '<span class="badge bad">Overdue</span>' : ""}</td>
    </tr>
  `).join("");

  const capacity = rooms.reduce((sum, room) => sum + room.cap, 0);
  const occupied = rooms.reduce((sum, room) => sum + room.occ, 0);

  const stat = (label, value, warn = false) => `
    <div class="stat${warn ? " warn" : ""}">
      <b>${value}</b><span>${label}</span>
    </div>
  `;

  // Beds used per block, for the occupancy chart
  const blocks = {};
  rooms.forEach((room) => {
    if (!blocks[room.hostel]) blocks[room.hostel] = { cap: 0, occ: 0 };
    blocks[room.hostel].cap += room.cap;
    blocks[room.hostel].occ += room.occ;
  });

  const occupancyBars = Object.entries(blocks).map(([block, data]) => `
    <div class="bar">
      <span>${esc(block)}</span>
      <i style="width:${data.cap ? Math.round((data.occ / data.cap) * 100) : 0}%"></i>
      <b>${data.occ}/${data.cap}</b>
    </div>
  `).join("");

  const latestRepairs = repairs.slice(0, 5).map((repair) => `
    <tr>
      <td>${esc(repair.room)}</td>
      <td>${esc(repair.item)}</td>
      <td>${badge(repair.status)}</td>
    </tr>
  `).join("");

  return `
    <div class="stats">
      ${stat("Total rooms", rooms.length)}
      ${stat("Registered students", students.length)}
      ${stat("Available rooms", available)}
      ${stat("Full rooms", full)}
      ${stat("Occupied beds", `${occupied} / ${capacity}`)}
      ${stat("Pending fines", pendingFines, pendingFines > 0)}
      ${stat("Active repairs", activeRepairs)}
    </div>

    <h3 class="section-title">Maintenance</h3>
    <div class="stats">
      ${stat("Pending", mCount("Pending"), mCount("Pending") > 0)}
      ${stat("In progress", mCount("In Progress"))}
      ${stat("Completed", mCount("Completed"))}
      ${stat("Overdue", mOverdue, mOverdue > 0)}
    </div>

    <div class="card">
      <h3>Open maintenance jobs</h3>
      ${openJobRows ? `
        <div class="scroll">
          <table>
            <thead><tr>
              <th>Room</th><th>Type</th><th>Problem</th><th>Staff</th><th>Status</th><th>Expected</th>
            </tr></thead>
            <tbody>${openJobRows}</tbody>
          </table>
        </div>
        ${openJobs.length > 5 ? `<p class="muted">Showing 5 of ${openJobs.length} open jobs.</p>` : ""}
      ` : '<p class="empty">No open maintenance jobs.</p>'}
      <button type="button" class="btn ghost small" data-goto="maintenance">Open maintenance page</button>
    </div>

    <div class="cols">
      <div class="card">
        <h3>Occupancy by block</h3>
        ${occupancyBars || '<p class="empty">No rooms loaded yet.</p>'}
      </div>

      <div class="card">
        <h3>Latest repair requests</h3>
        ${latestRepairs
          ? `<table><tbody>${latestRepairs}</tbody></table>`
          : '<p class="empty">No repair requests yet.</p>'}
      </div>
    </div>
  `;
};
