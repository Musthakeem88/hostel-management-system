/* js/views/dashboard.js */

views.dashboard = function () {
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
      ${stat("Maintenance rooms", maintenance, maintenance > 0)}
      ${stat("Occupied beds", `${occupied} / ${capacity}`)}
      ${stat("Pending fines", pendingFines, pendingFines > 0)}
      ${stat("Active repairs", activeRepairs)}
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
