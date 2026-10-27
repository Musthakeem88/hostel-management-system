/* js/views/repairs.js  —  repair requests (completed requests are locked) */

views.repairs = function () {
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
                  <td class="wrap">${esc(repair.description)}</td>
                  <td>${badge(repair.priority)}</td>
                  <td>${badge(repair.status)}</td>
                  <td>
                      <div class="actions">
                      <select data-repair-status="${esc(repair.dbId)}"
                      ${locked ? "disabled" : ""}>
                      ${REPAIR_FLOW.map((status) => `
                        <option value="${esc(status)}"
                          ${status === repair.status ? "selected" : ""}>
                          ${esc(status)}
                        </option>
                      `).join("")}
                    </select>
                    ${locked ? '<span class="badge good">Locked</span>' : ""}</div>
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
};
