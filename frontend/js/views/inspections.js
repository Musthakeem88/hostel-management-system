views.inspections = function () {
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
};
