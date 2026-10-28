async function loadRoomsFromDatabase() {
  try {
    const data = await apiRequest(`${API_BASE}/rooms`);
    const rows = Array.isArray(data) ? data : data.rooms;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected room data received.");
    }

    rooms = rows.map((room) => ({
      no: room.room_id ||
        formatRoom(room.block, room.floor, room.room_number),
      hostel: `Block ${room.block}`,
      cap: Number(room.capacity),
      occ: Number(room.occupied),
      fix: room.under_maintenance === true
    }));

    populateStudentRooms();

    if (view.dataset.name) render(view.dataset.name);
  } catch (error) {
    console.error(error);
    toast("Could not load rooms. Check the backend server.");
  }
}

async function loadStudents() {
  try {
    const data = await apiRequest(`${API_BASE}/students`);
    students = Array.isArray(data) ? data : data.students;

    if (!Array.isArray(students)) {
      throw new Error("Unexpected student data received.");
    }

    if (view.dataset.name === "students") {
      renderStudentsTable();
    } else if (view.dataset.name === "dashboard") {
      render("dashboard");
    }
  } catch (error) {
    console.error(error);
    toast("Could not load students.");
  }
}

async function loadInspections() {
  try {
    const data = await apiRequest(`${API_BASE}/inspections`);
    const rows = Array.isArray(data) ? data : data.inspections;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected inspection data received.");
    }

    inspections = rows.map((row) => {
      let items = row.inspection_items;

      if (typeof items === "string") {
        try {
          items = JSON.parse(items);
        } catch {
          items = [];
        }
      }

      return {
        id: `I-${row.inspection_id}`,
        room: formatRoom(row.room_block, row.room_floor, row.room_number),
        type: row.inspection_type,
        student: row.student_number,
        date: row.inspection_date
          ? new Date(row.inspection_date).toLocaleString()
          : "-",
        items: Array.isArray(items) ? items : []
      };
    });

    if (view.dataset.name === "inspections") render("inspections");
  } catch (error) {
    console.error(error);
    toast("Could not load inspections.");
  }
}

async function loadDamages() {
  try {
    const data = await apiRequest(`${API_BASE}/damages`);
    const rows = Array.isArray(data) ? data : data.damages;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected damage report data received.");
    }

    damages = rows.map((row) => ({
      dbId: row.damage_id,
      id: row.report_number || `D-${row.damage_id}`,
      room: formatRoom(row.room_block, row.room_floor, row.room_number),
      item: row.item_name,
      student: row.student_number,
      description: row.description,
      cost: Number(row.fine_amount || 0),
      status: row.fine_status || "Pending",
      disputeReason: row.dispute_reason || ""
    }));

    if (["damage", "dashboard"].includes(view.dataset.name)) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error(error);
    toast("Could not load damage reports.");
  }
}

async function loadRepairs() {
  try {
    const data = await apiRequest(`${API_BASE}/repairs`);
    const rows = Array.isArray(data) ? data : data.repairs;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected repair request data received.");
    }

    repairs = rows.map((row) => ({
      dbId: row.repair_id,
      id: row.request_number || `R-${row.repair_id}`,
      room: formatRoom(row.room_block, row.room_floor, row.room_number),
      item: row.item_name,
      description: row.description,
      priority: row.priority || "Normal",
      status: row.repair_status || "Reported"
    }));

    if (["repairs", "dashboard"].includes(view.dataset.name)) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error(error);
    toast("Could not load repair requests.");
  }
}

async function loadMaintenance() {
  try {
    const data = await apiRequest(`${API_BASE}/maintenance`);
    const rows = Array.isArray(data) ? data : data.maintenance;

    if (!Array.isArray(rows)) {
      throw new Error("Unexpected maintenance data received.");
    }

    maintenance = rows.map((row) => ({
      dbId: row.maintenance_id,
      room: formatRoom(row.room_block, row.room_floor, row.room_number),
      type: row.maintenance_type,
      description: row.description,
      staff: row.assigned_staff || "",
      status: row.status || "Pending",
      reported: row.reported_date,
      expected: row.expected_completion_date || "",
      completed: row.completed_date || ""
    }));

    if (["maintenance", "dashboard"].includes(view.dataset.name)) {
      render(view.dataset.name);
    }
  } catch (error) {
    console.error(error);
    toast("Could not load maintenance requests.");
  }
}
