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
