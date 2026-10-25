
const inspectionForm = document.getElementById("inspectionForm");
const inspectionRecords = document.getElementById("inspectionRecords");

let inspections = [];

inspectionForm.addEventListener("submit", function (event) {
  event.preventDefault();

  const roomNumber = document.getElementById("roomNumber").value.trim();
  const inspectionType = document.getElementById("inspectionType").value;
  const item = document.getElementById("item").value;
  const condition = document.getElementById("condition").value;
  const notes = document.getElementById("notes").value.trim();

  const inspection = {
    roomNumber,
    inspectionType,
    item,
    condition,
    notes: notes || "No notes",
    date: new Date().toLocaleDateString()
  };

  inspections.push(inspection);

  displayInspections();
  inspectionForm.reset();

  alert("Inspection recorded successfully!");
});

function displayInspections() {
  inspectionRecords.innerHTML = "";

  inspections.forEach(function (inspection) {
    const row = document.createElement("tr");

    const values = [
      inspection.roomNumber,
      inspection.inspectionType,
      inspection.item,
      inspection.condition,
      inspection.notes,
      inspection.date
    ];

    values.forEach(function (value) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    inspectionRecords.appendChild(row);
  });
}
