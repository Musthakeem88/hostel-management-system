/* =========================================================
   js/actions.js  —  create / update data through the API
========================================================= */

/* ---------- Register student ---------- */

async function registerStudent(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const roomId = String(data.get("room_id") || "");
  const room = getRoom(roomId);

  if (!room || room.fix || Number(room.occ) >= Number(room.cap)) {
    toast("Please select an available room.");
    await loadRoomsFromDatabase();
    return;
  }

  const parts = roomId.split("-");
  const button = form.querySelector('[type="submit"]');

  if (button) {
    button.disabled = true;
    button.textContent = "Registering...";
  }

  try {
    const result = await apiRequest(`${API_BASE}/students`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_number: String(data.get("student_number") || "").trim(),
        full_name: String(data.get("full_name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
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
    toast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Register student";
    }
  }
}

/* ---------- Save inspection ---------- */

async function saveInspection(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const roomId = String(data.get("room") || "");
  const parts = roomId.split("-");
  const type = String(data.get("type") || "");
  const studentNumber = String(data.get("student") || "").trim();
  const student = getStudent(studentNumber);

  if (parts.length !== 3 || !getRoom(roomId)) {
    toast("Please select a valid room.");
    return;
  }

  if (!["Check-in", "Check-out"].includes(type)) {
    toast("Please select a valid inspection type.");
    return;
  }

  if (!student) {
    toast("This student number is not registered.");
    return;
  }

  if (
    String(student.room_block).trim() !== parts[0] ||
    Number(student.room_floor) !== Number(parts[1]) ||
    Number(student.room_number) !== Number(parts[2])
  ) {
    toast("The student is not assigned to this room.");
    return;
  }

  const items = ITEMS.map((item, index) => ({
    item,
    condition: String(data.get(`condition_${index}`) || "Good"),
    note: String(data.get(`note_${index}`) || "").trim()
  }));

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        student_number: studentNumber,
        inspection_type: type,
        inspection_items: items
      })
    });

    toast(result.message || "Inspection saved.");
    form.reset();
    await loadInspections();
    render("inspections");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------- Create damage report ---------- */

async function createDamageReport(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const parts = String(data.get("room") || "").split("-");
  const item = String(data.get("item") || "");
  const studentNumber = String(data.get("student") || "").trim();
  const description = String(data.get("description") || "").trim();
  const rawFine = String(data.get("cost") ?? "").trim();
  const student = getStudent(studentNumber);

  if (parts.length !== 3 || !getRoom(parts.join("-"))) {
    toast("Please select a valid room.");
    return;
  }

  if (!ITEMS.includes(item)) {
    toast("Please select a valid item.");
    return;
  }

  if (!student) {
    toast("This student number is not registered.");
    return;
  }

  if (
    String(student.room_block).trim() !== parts[0] ||
    Number(student.room_floor) !== Number(parts[1]) ||
    Number(student.room_number) !== Number(parts[2])
  ) {
    toast("The student is not assigned to this room.");
    return;
  }

  const fineAmount = Number(rawFine);

  if (!description || rawFine === "" ||
      !Number.isFinite(fineAmount) || fineAmount < 0) {
    toast("Enter a description and a valid fine amount.");
    return;
  }

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/damages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        item_name: item,
        student_number: studentNumber,
        description,
        fine_amount: fineAmount
      })
    });

    toast(result.message || "Damage report created.");
    form.reset();
    await loadDamages();
    render("damage");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------- Create repair request ---------- */

async function createRepair(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const parts = String(data.get("room") || "").split("-");
  const item = String(data.get("item") || "");
  const description = String(data.get("description") || "").trim();
  const priority = String(data.get("priority") || "Normal");

  if (parts.length !== 3 || !getRoom(parts.join("-"))) {
    toast("Please select a valid room.");
    return;
  }

  if (!ITEMS.includes(item) || !description) {
    toast("Select an item and enter a description.");
    return;
  }

  if (!["Normal", "Urgent"].includes(priority)) {
    toast("Invalid repair priority.");
    return;
  }

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/repairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        item_name: item,
        description,
        priority
      })
    });

    toast(result.message || "Repair request created.");
    form.reset();
    await loadRepairs();
    render("repairs");
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------- Update fine status (Paid reports are locked) ---------- */

async function updateFineStatus(damage, status, disputeReason = undefined) {
  if (!damage || damage.dbId == null) {
    throw new Error("Damage report not found.");
  }

  if (!FINE_FLOW.includes(status)) {
    throw new Error("Invalid fine status.");
  }

  if (damage.status === "Paid") {
    throw new Error("This report is already Paid and locked.");
  }

  const body = { status };

  if (disputeReason !== undefined) {
    body.dispute_reason = disputeReason;
  }

  const result = await apiRequest(
    `${API_BASE}/damages/${encodeURIComponent(damage.dbId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

  await loadDamages();
  toast(result.message || "Fine status updated successfully.");
}

/* ---------- Update repair status (Completed requests are locked) ---------- */

async function updateRepairStatus(repair, status) {
  if (!repair || repair.dbId == null) {
    throw new Error("Repair request not found.");
  }

  if (!REPAIR_FLOW.includes(status)) {
    throw new Error("Invalid repair status.");
  }

  if (repair.status === "Completed") {
    throw new Error("This repair is already Completed and locked.");
  }

  const result = await apiRequest(
    `${API_BASE}/repairs/${encodeURIComponent(repair.dbId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }
  );

  await loadRepairs();
  toast(result.message || "Repair status updated successfully.");
}

/* ---------- Maintenance: add, view, edit, mark as completed ---------- */

const modal = $("#modal");
const modalBody = $("#modal-body");

function closeModal() {
  if (modal && modal.open) modal.close();
}

function showModal(html) {
  modalBody.innerHTML = html;
  if (!modal.open) modal.showModal();
}

function findMaintenance(id) {
  return maintenance.find((job) => String(job.dbId) === String(id));
}

function maintenanceDetails(job) {
  return `
    <dl class="details">
      <dt>Room</dt><dd>${esc(job.room)}</dd>
      <dt>Maintenance type</dt><dd>${esc(job.type)}</dd>
      <dt>Status</dt><dd>${badge(job.status)} ${isOverdue(job) ? '<span class="badge bad">Overdue</span>' : ""}</dd>
      <dt>Reported date</dt><dd>${formatDate(job.reported)}</dd>
      <dt>Assigned staff</dt><dd>${job.staff ? esc(job.staff) : "Unassigned"}</dd>
      <dt>Expected completion</dt><dd>${formatDate(job.expected)}</dd>
      ${job.completed ? `<dt>Completed on</dt><dd>${formatDate(job.completed)}</dd>` : ""}
      <dt>Problem</dt><dd>${esc(job.description)}</dd>
    </dl>
  `;
}

function openMaintenanceView(id) {
  const job = findMaintenance(id);

  if (!job) {
    toast("Maintenance request not found.");
    return;
  }

  const done = job.status === "Completed";

  showModal(`
    <div class="modal-head">
      <h3>Maintenance details</h3>
      <button type="button" class="icon-btn" data-modal-close aria-label="Close">&times;</button>
    </div>
    ${maintenanceDetails(job)}
    <div class="modal-actions">
      ${done ? "" : `
        <button type="button" class="btn ghost" data-maint-edit="${esc(job.dbId)}">Edit</button>
        <button type="button" class="btn" data-maint-complete="${esc(job.dbId)}">Mark as completed</button>
      `}
      <button type="button" class="btn ghost" data-modal-close>Close</button>
    </div>
  `);
}

function openMaintenanceEdit(id) {
  const job = findMaintenance(id);

  if (!job) {
    toast("Maintenance request not found.");
    return;
  }

  if (job.status === "Completed") {
    toast("Completed maintenance requests cannot be changed.");
    return;
  }

  showModal(`
    <div class="modal-head">
      <h3>Edit maintenance</h3>
      <button type="button" class="icon-btn" data-modal-close aria-label="Close">&times;</button>
    </div>
    <p class="muted modal-sub">Room ${esc(job.room)} &middot; reported ${formatDate(job.reported)}</p>
    <form id="maintenance-edit-form" data-id="${esc(job.dbId)}">
      <div class="form">
        <label>Maintenance type *
          <select name="type" required>${maintenanceTypeOptions(job.type)}</select>
        </label>
        <label>Status *
          <select name="status" required>
            ${MAINTENANCE_STATUS.map((status) =>
              `<option value="${esc(status)}"${status === job.status ? " selected" : ""}>${esc(status)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Assigned staff
          <input name="staff" list="staff-list" maxlength="100" value="${esc(job.staff)}" autocomplete="off">
          ${staffDatalist()}
        </label>
        <label>Expected completion date
          <input type="date" name="expected" value="${esc(job.expected)}" min="${esc(job.reported)}">
        </label>
      </div>
      <label>Problem description *
        <textarea name="description" maxlength="1000" required>${esc(job.description)}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-modal-close>Cancel</button>
        <button type="submit" class="btn">Save changes</button>
      </div>
    </form>
  `);
}

async function createMaintenance(event) {
  event.preventDefault();

  const form = event.target;
  const data = new FormData(form);
  const parts = String(data.get("room") || "").split("-");
  const type = String(data.get("type") || "");
  const description = String(data.get("description") || "").trim();
  const reported = String(data.get("reported") || "");
  const expected = String(data.get("expected") || "");

  if (parts.length !== 3 || !getRoom(parts.join("-"))) {
    toast("Please select a valid room.");
    return;
  }

  if (!MAINTENANCE_TYPES.includes(type)) {
    toast("Select a maintenance type.");
    return;
  }

  if (!description) {
    toast("Enter the problem description.");
    return;
  }

  if (expected && reported && expected < reported) {
    toast("Expected completion cannot be before the reported date.");
    return;
  }

  const button = form.querySelector('[type="submit"]');
  if (button) button.disabled = true;

  try {
    const result = await apiRequest(`${API_BASE}/maintenance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_block: parts[0],
        room_floor: Number(parts[1]),
        room_number: Number(parts[2]),
        maintenance_type: type,
        description,
        assigned_staff: String(data.get("staff") || "").trim(),
        reported_date: reported,
        expected_completion_date: expected
      })
    });

    toast(result.message || "Maintenance request added.");
    form.reset();
    await loadMaintenance();
    render("maintenance");
  } catch (error) {
    console.error(error);
    toast(error.message || "Could not add the maintenance request.");
  } finally {
    if (button) button.disabled = false;
  }
}


async function saveMaintenanceEdit(event) {
  event.preventDefault();

  const form = event.target;
  const job = findMaintenance(form.dataset.id);
  const data = new FormData(form);

  const description = String(data.get("description") || "").trim();
  const expected = String(data.get("expected") || "");
  const type = String(data.get("type") || "");
  const status = String(data.get("status") || "");
  const staff = String(data.get("staff") || "").trim();

  if (!job) {
    toast("Maintenance request not found.");
    return;
  }

  if (!description) {
    toast("Enter the problem description.");
    return;
  }

  if (!MAINTENANCE_TYPES.includes(type)) {
    toast("Select a valid maintenance type.");
    return;
  }

  if (!MAINTENANCE_STATUS.includes(status)) {
    toast("Select a valid maintenance status.");
    return;
  }

  // Compare date strings in YYYY-MM-DD format.
  const reported = String(job.reported || "").slice(0, 10);

  if (expected && reported && expected < reported) {
    toast(
      `Expected completion must be on or after the reported date (${reported}).`
    );
    return;
  }

  const button = form.querySelector('[type="submit"]');

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {
    const result = await apiRequest(
      `${API_BASE}/maintenance/${encodeURIComponent(job.dbId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          maintenance_type: type,
          status,
          assigned_staff: staff,
          expected_completion_date: expected,
          description
        })
      }
    );

    toast(result.message || "Maintenance request updated.");

    closeModal();

    await loadMaintenance();
    render("maintenance");
  } catch (error) {
    console.error("Error saving maintenance edit:", error);
    toast(error.message || "Could not update the maintenance request.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Save changes";
    }
  }
}


async function completeMaintenance(id) {
  const job = findMaintenance(id);

  if (!job) {
    toast("Maintenance request not found.");
    return;
  }

  if (job.status === "Completed") {
    toast("This request is already completed.");
    return;
  }

  if (!confirm(`Mark the ${job.type.toLowerCase()} job in room ${job.room} as completed? Completed requests cannot be changed.`)) {
    return;
  }

  try {
    const result = await apiRequest(`${API_BASE}/maintenance/${encodeURIComponent(job.dbId)}/complete`, {
      method: "PATCH"
    });

    toast(result.message || "Maintenance marked as completed.");
    closeModal();
    await loadMaintenance();
  } catch (error) {
    console.error(error);
    toast(error.message || "Could not complete the maintenance request.");
  }
}

/* Click handler for every maintenance button (page, dialog and dashboard) */
function handleMaintenanceClick(target) {
  const d = target.dataset;

  if (d.goto) navigate(d.goto);
  else if (d.maintFilter) {
    selectedMaintenanceFilter = d.maintFilter;
    render("maintenance");
  }
  else if (d.maintView) openMaintenanceView(d.maintView);
  else if (d.maintEdit) openMaintenanceEdit(d.maintEdit);
  else if (d.maintComplete) completeMaintenance(d.maintComplete);
  else if ("modalClose" in d) closeModal();
}

