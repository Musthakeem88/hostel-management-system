/* =========================================================
   HELPERS
========================================================= */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function toast(message) {
  if (!toastElement) {
    alert(message);
    return;
  }

  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    toastElement.classList.remove("show");
  }, 3000);
}

function roomStatus(room) {
  if (room.fix) return "Maintenance";
  if (Number(room.occ) >= Number(room.cap)) return "Full";
  if (Number(room.occ) === 0) return "Available";
  return "Occupied";
}

function tone(status) {
  const value = String(status || "").toLowerCase();

  if (["paid", "completed", "good", "available"].includes(value)) {
    return "good";
  }

  if (["broken", "urgent", "maintenance"].includes(value)) {
    return "bad";
  }

  if (["pending", "damaged", "reported", "under review", "full"].includes(value)) {
    return "warn";
  }

  return "info";
}

function badge(status) {
  return `<span class="badge ${tone(status)}">${esc(status)}</span>`;
}

function roomOptions(includeUnavailable = false) {
  return rooms
    .filter((room) =>
      includeUnavailable || (!room.fix && Number(room.occ) < Number(room.cap))
    )
    .map((room) => `
      <option value="${esc(room.no)}">
        ${esc(room.no)} (${room.occ}/${room.cap})
      </option>
    `)
    .join("");
}

function itemOptions() {
  return ITEMS.map((item) =>
    `<option value="${esc(item)}">${esc(item)}</option>`
  ).join("");
}

function conditionOptions() {
  return CONDITIONS.map((condition) =>
    `<option value="${esc(condition)}">${esc(condition)}</option>`
  ).join("");
}

function getRoom(roomId) {
  return rooms.find((room) => room.no === roomId);
}

function getStudent(studentNumber) {
  return students.find(
    (student) =>
      String(student.student_number || "").trim() ===
      String(studentNumber || "").trim()
  );
}

function formatRoom(block, floor, roomNumber) {
  return `${String(block).trim()}-${String(floor).padStart(2, "0")}-${String(roomNumber).padStart(2, "0")}`;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

/* Copies each column heading onto its cells (data-label) so tables can
   turn into stacked cards on phones without changing any markup. */
function labelTables(root = document) {
  const tables = root.matches && root.matches("table")
    ? [root]
    : root.querySelectorAll("table");

  tables.forEach((table) => {
    const headings = Array.from(table.querySelectorAll("thead th")).map(
      (th) => th.textContent.trim()
    );

    if (!headings.length) return;

    table.classList.add("rtable");

    table.querySelectorAll("tbody tr").forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell.hasAttribute("colspan")) {
          cell.classList.add("empty-row");
        } else if (headings[index]) {
          cell.setAttribute("data-label", headings[index]);
        }
      });
    });
  });
}
