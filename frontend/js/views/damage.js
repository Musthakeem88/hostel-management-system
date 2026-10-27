/* js/views/damage.js  —  damage reports and fines */

views.damage = function () {
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
                  <td class="wrap">${esc(damage.description)}</td>
                  <td>${damage.cost.toFixed(2)}</td>
                  <td>${badge(damage.status)}</td>
                  <td>
                      <div class="actions">
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
                        : `<button type="button" class="btn ghost small" data-dispute="${esc(damage.id)}">Dispute</button>`
                    }
                  </div>
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
};
