/* js/views/rooms.js */

views.rooms = function () {
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
};
