/* =========================================================
   js/app.js  —  rendering, navigation, events and start-up
========================================================= */

/* ---------- Render & navigation ---------- */

const pageTitles = {
  dashboard: "Dashboard",
  rooms: "Rooms",
  students: "Student Management",
  inspections: "Inspections",
  damage: "Damage and fines",
  repairs: "Repairs",
  maintenance: "Maintenance"
};

function render(name) {
  if (!views[name]) name = "dashboard";

  titleElement.textContent = pageTitles[name] || name;
  view.dataset.name = name;
  view.innerHTML = views[name]();
  labelTables(view);

  nav.querySelectorAll("button[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });

  if (name === "students") {
    populateStudentRooms();
    renderStudentsTable();
  }
}

/* ---------- Navigation events ---------- */

async function navigate(page) {
  render(page);
  window.scrollTo({ top: 0 });

  if (page === "students") await loadStudents();
  if (page === "inspections") await loadInspections();
  if (page === "damage") await loadDamages();
  if (page === "repairs") await loadRepairs();
  if (page === "maintenance") await loadMaintenance();
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;

  navigate(button.dataset.view);
});

/* ---------- Click events ---------- */

view.addEventListener("click", (event) => {
  const maintenanceButton = event.target.closest(
    "[data-maint-filter], [data-maint-view], [data-maint-edit], [data-maint-complete], [data-goto]"
  );

  if (maintenanceButton) {
    handleMaintenanceClick(maintenanceButton);
    return;
  }

  const filterButton = event.target.closest("[data-room-filter]");

  if (filterButton) {
    selectedRoomFilter = filterButton.dataset.roomFilter;
    render("rooms");
    return;
  }

  const disputeButton = event.target.closest("[data-dispute]");

  if (disputeButton) {
    const damage = damages.find(
      (item) => item.id === disputeButton.dataset.dispute
    );

    if (!damage) {
      toast("Damage report not found.");
      return;
    }

    if (damage.status === "Paid") {
      toast("Paid reports cannot be disputed.");
      return;
    }

    const reason = prompt("Enter the reason for disputing this fine:");

    if (reason && reason.trim()) {
      updateFineStatus(damage, "Under Review", reason.trim())
        .then(() => {
          if (view.dataset.name === "damage") render("damage");
        })
        .catch((error) => {
          toast(error.message || "Could not submit dispute.");
        });
    }
  }
});

/* ---------- Status change events ---------- */

view.addEventListener("change", async (event) => {
  const fineSelect = event.target.closest("[data-fine-status]");

  if (fineSelect) {
    const damage = damages.find(
      (item) => String(item.dbId) === String(fineSelect.dataset.fineStatus)
    );

    if (!damage || damage.status === "Paid") {
      toast("This report cannot be changed.");
      render("damage");
      return;
    }

    const selectedStatus = fineSelect.value;
    fineSelect.disabled = true;

    try {
      await updateFineStatus(damage, selectedStatus);
    } catch (error) {
      console.error(error);
      toast(error.message || "Could not update fine status.");
    } finally {
      await loadDamages();
      if (view.dataset.name === "damage") render("damage");
    }

    return;
  }

  const repairSelect = event.target.closest("[data-repair-status]");

  if (repairSelect) {
    const repair = repairs.find(
      (item) => String(item.dbId) === String(repairSelect.dataset.repairStatus)
    );

    if (!repair || repair.status === "Completed") {
      toast("This repair is already Completed and locked.");
      render("repairs");
      return;
    }

    const selectedStatus = repairSelect.value;
    repairSelect.disabled = true;

    try {
      await updateRepairStatus(repair, selectedStatus);
    } catch (error) {
      console.error(error);
      toast(error.message || "Could not update repair status.");
    } finally {
      await loadRepairs();
      if (view.dataset.name === "repairs") render("repairs");
    }
  }
});

/* ---------- Form submission events ---------- */

view.addEventListener("submit", (event) => {
  const form = event.target;

  if (!(form instanceof HTMLFormElement)) return;

  if ([
    "student-form",
    "inspection-form",
    "damage-form",
    "repair-form",
    "maintenance-form"
  ].includes(form.id)) {
    event.preventDefault();
  }

  if (form.id === "student-form") {
    registerStudent(event);
  } else if (form.id === "inspection-form") {
    saveInspection(event);
  } else if (form.id === "damage-form") {
    createDamageReport(event);
  } else if (form.id === "repair-form") {
    createRepair(event);
  } else if (form.id === "maintenance-form") {
    createMaintenance(event);
  }
});

/* ---------- Maintenance dialog (View / Edit) ---------- */

modal.addEventListener("click", (event) => {
  if (event.target === modal) {            // click on the dark backdrop
    closeModal();
    return;
  }

  const button = event.target.closest(
    "[data-maint-edit], [data-maint-complete], [data-modal-close]"
  );

  if (button) handleMaintenanceClick(button);
});

modal.addEventListener("submit", (event) => {
  if (event.target.id === "maintenance-edit-form") {
    saveMaintenanceEdit(event);
  }
});

/* ---------- Start the app ---------- */

if ($("#today")) {
  $("#today").textContent = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

render("dashboard");

loadRoomsFromDatabase();
loadStudents();
loadInspections();
loadDamages();
loadRepairs();
loadMaintenance();
