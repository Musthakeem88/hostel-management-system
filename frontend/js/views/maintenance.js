/* js/views/maintenance.js  —  maintenance requests (add, view, edit, complete) */

views.maintenance = function () {
  const counts = { All: maintenance.length };
  MAINTENANCE_STATUS.forEach((status) => {
    counts[status] = maintenance.filter((job) => job.status === status).length;
  });

  const filtered = maintenance.filter(
    (job) => selectedMaintenanceFilter === "All" || job.status === selectedMaintenanceFilter
  );

  return `
    <div class="card">
      <h3>Add maintenance</h3>
      <form id="maintenance-form">
        <div class="form">
          <label>Room *
            <select name="room" required>
              <option value="">Select room</option>${roomOptions(true)}
            </select>
          </label>
          <label>Maintenance type *
            <select name="type" required>${maintenanceTypeOptions()}</select>
          </label>
          <label>Assigned staff
            <input name="staff" list="staff-list" maxlength="100" placeholder="e.g. Ahmad Faiz" autocomplete="off">
            ${staffDatalist()}
          </label>
          <label>Reported date *
            <input type="date" name="reported" value="${todayISO()}" required>
          </label>
          <label>Expected completion date
            <input type="date" name="expected" min="${todayISO()}">
          </label>
        </div>
        <label>Problem description *
          <textarea name="description" maxlength="1000" required></textarea>
        </label>
        <button class="btn" type="submit">Add maintenance</button>
      </form>
    </div>

    <div class="card">
      <h3>Maintenance requests</h3>
      <div class="filters">
        ${["All", ...MAINTENANCE_STATUS].map((status) => `
          <button type="button" data-maint-filter="${esc(status)}"
            class="${selectedMaintenanceFilter === status ? "active" : ""}">
            ${esc(status)} (${counts[status]})
          </button>
        `).join("")}
      </div>
      <div class="scroll">
        <table>
          <thead><tr>
            <th>Room</th><th>Type</th><th>Problem</th><th>Reported</th>
            <th>Staff</th><th>Status</th><th>Expected completion</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${filtered.map((job) => {
              const done = job.status === "Completed";

              return `
                <tr>
                  <td>${esc(job.room)}</td>
                  <td>${esc(job.type)}</td>
                  <td class="wrap">${esc(job.description)}</td>
                  <td>${formatDate(job.reported)}</td>
                  <td>${job.staff ? esc(job.staff) : '<span class="muted">Unassigned</span>'}</td>
                  <td>${badge(job.status)}</td>
                  <td>
                    <span class="nowrap">${done && job.completed ? `Done ${formatDate(job.completed)}` : formatDate(job.expected)}</span>
                    ${isOverdue(job) ? '<span class="badge bad">Overdue</span>' : ""}
                  </td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn ghost small" data-maint-view="${esc(job.dbId)}">View</button>
                      ${done
                        ? '<span class="badge good">Locked</span>'
                        : `<button type="button" class="btn ghost small" data-maint-edit="${esc(job.dbId)}">Edit</button>
                           <button type="button" class="btn small" data-maint-complete="${esc(job.dbId)}">Mark as completed</button>`}
                    </div>
                  </td>
                </tr>
              `;
            }).join("") || '<tr><td colspan="8">No maintenance requests found.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
};
