/* js/views/students.js */

views.students = function () {
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
};

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

  labelTables(tbody.closest("table"));
}
