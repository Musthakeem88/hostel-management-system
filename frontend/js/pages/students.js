/* js/pages/students.js  —  student records, allocation to rooms, documents and check-out */

pages.students = {
  async load() {
    const [students, rooms] = await Promise.all([api("/students"), api("/rooms")]);
    state.d.students = { students, rooms };
  },

  render() {
    const { students, rooms } = state.d.students;
    const f = ui("students", { status: "All", q: "" });
    const counts = { All: students.length, Active: 0, "Checked out": 0 };
    students.forEach((s) => { counts[s.student_status === "Checked out" ? "Checked out" : "Active"] += 1; });

    const list = students.filter((s) =>
      (f.status === "All" || (s.student_status || "Active") === f.status) &&
      matches(s, f.q, ["student_number", "full_name", "email", "faculty"]));

    return `
      <div class="card">
        <h3>Register a student in a room</h3>
        <form data-form="student-register">
          <div class="form">
            <label>Student number * <input name="student_number" required maxlength="30"></label>
            <label>Full name * <input name="full_name" required maxlength="120"></label>
            <label>Email * <input name="email" type="email" required maxlength="150"></label>
            <label>Phone <input name="phone" maxlength="30"></label>
            <label>Faculty <input name="faculty" maxlength="120"></label>
            <label>Emergency contact <input name="emergency_contact_name" maxlength="120"></label>
            <label>Emergency phone <input name="emergency_contact_phone" maxlength="30"></label>
            <label>Room *
              <select name="room" required>${roomOptionsHtml(rooms, { onlyFree: true, blank: "Select an available room" })}</select>
            </label>
          </div>
          <button class="btn" type="submit">Register student</button>
        </form>
      </div>

      <div class="toolbar">
        ${filterChips("students.status", ["All", "Active", "Checked out"], f.status, counts)}
        <input class="grow" type="search" placeholder="Search by name, number, email…" value="${esc(f.q)}" data-input="filter" data-filter="students.q" aria-label="Search students">
        ${can("reports") ? '<button class="btn ghost" data-action="export" data-report="allocation" data-format="xlsx">Export</button>' : ""}
      </div>

      <div class="card">
        ${tbl([
          { label: "Student", render: (s) => `<button class="link" data-action="student-open" data-id="${esc(s.student_number)}">${esc(s.student_number)}</button>` },
          { label: "Name", key: "full_name" },
          { label: "Faculty", render: (s) => esc(s.faculty || "—") },
          { label: "Room", render: (s) => esc(roomLabel(s)) },
          { label: "Phone", render: (s) => esc(s.phone || "—") },
          { label: "Status", render: (s) => badge(s.student_status || "Active") },
          { label: "Check-in", render: (s) => fmtDate(s.check_in_date) },
          { label: "", render: (s) => `<button class="btn ghost small" data-action="student-open" data-id="${esc(s.student_number)}">Open</button>` }
        ], list, { empty: "No students registered yet." })}
      </div>`;
  }
};

forms["student-register"] = async (form) => {
  const v = formData(form);
  const parts = String(v.room || "").split("-");
  if (parts.length < 3) { toast("Select an available room.", "error"); return; }

  await submitting(form, async () => {
    const result = await attempt(() => api("/students", { method: "POST", body: {
      student_number: v.student_number, full_name: v.full_name, email: v.email, phone: v.phone || undefined,
      faculty: v.faculty, emergency_contact_name: v.emergency_contact_name, emergency_contact_phone: v.emergency_contact_phone, room_id: v.room,
      room_block: parts.slice(0, -2).join("-"), room_floor: Number(parts.at(-2)), room_number: Number(parts.at(-1))
    } }));
    if (result) form.reset();
  });
};

async function openStudent(number) {
  try {
    const d = await api(`/students/${encodeURIComponent(number)}`);
    const s = d.student;
    const active = !s.student_status || s.student_status === "Active";

    openModal(`
      ${modalHead(s.full_name)}
      ${dl([
        ["Student number", `<span class="mono">${esc(s.student_number)}</span>`], ["Status", badge(s.student_status || "Active")],
        ["Room", esc(roomLabel(s))], ["Hostel", `Block ${esc(s.room_block)}`],
        ["Email", esc(s.email)], ["Phone", esc(s.phone || "—")], ["Faculty", esc(s.faculty || "—")],
        ["Emergency contact", esc([s.emergency_contact_name, s.emergency_contact_phone].filter(Boolean).join(" · ") || "—")],
        ["Check-in", fmtDate(s.check_in_date)], ["Check-out", fmtDate(s.check_out_date)]
      ])}

      ${isRole("administrator") ? `${section("Security deposit")}${dl([["Paid", money(d.deposit.deposit_paid)], ["Taken for fines", money(d.deposit.deducted)], ["Refunded", money(d.deposit.refunded)], ["Balance", `<b>${money(d.deposit.balance)}</b>`], ["Unpaid fines", money(d.deposit.unpaid_fines)]])}` : ""}

      ${section("Documents")}
      ${d.documents.length ? `<ul>${d.documents.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.doc_type)}</a>${x.note ? ` — ${esc(x.note)}` : ""} <span class="muted">${fmtDate(String(x.created_at).slice(0, 10))}</span></li>`).join("")}</ul>` : '<p class="muted">No documents uploaded.</p>'}

      <div class="modal-actions">
        <button class="btn ghost" data-action="student-edit" data-id="${esc(s.student_number)}">Edit details</button>
        <button class="btn ghost" data-action="student-doc" data-id="${esc(s.student_number)}">Add document</button>
        ${active ? `<button class="btn danger" data-action="student-checkout" data-id="${esc(s.student_number)}">Check out</button>` : ""}
        ${!active && isRole("administrator") ? `<button class="btn" data-goto="fees">Settle deposit</button>` : ""}
      </div>`, { wide: true });
  } catch (error) { toast(error.message, "error"); }
}

actions["student-open"] = (el) => openStudent(el.dataset.id);

actions["student-edit"] = async (el) => {
  const d = await api(`/students/${encodeURIComponent(el.dataset.id)}`);
  const s = d.student;
  const v = await formModal({
    title: `Edit ${s.full_name}`,
    fields: [
      { name: "full_name", label: "Full name", required: true, maxlength: 120, value: s.full_name },
      { name: "email", label: "Email", required: true, maxlength: 150, value: s.email },
      { name: "phone", label: "Phone", maxlength: 30, value: s.phone },
      { name: "faculty", label: "Faculty", maxlength: 120, value: s.faculty },
      { name: "emergency_contact_name", label: "Emergency contact", maxlength: 120, value: s.emergency_contact_name },
      { name: "emergency_contact_phone", label: "Emergency phone", maxlength: 30, value: s.emergency_contact_phone }
    ]
  });
  if (!v) return;
  const ok = await attempt(() => api(`/students/${encodeURIComponent(s.student_number)}`, { method: "PUT", body: v }));
  if (ok) openStudent(s.student_number);
};

actions["student-doc"] = async (el) => {
  const number = el.dataset.id;
  const v = await formModal({
    title: "Add a document",
    fields: [
      { name: "doc_type", label: "Document type", type: "select", options: ["Offer letter", "ID / passport", "Medical form", "Hostel agreement", "Other"], required: true },
      { name: "note", label: "Note", maxlength: 200 }
    ],
    extra: `<label>File (photo or PDF) *<input type="file" id="doc-file" accept="image/*,application/pdf" required></label>`,
    submitText: "Upload"
  });
  if (!v) return;
  const file = $("#doc-file") && $("#doc-file").files[0];
  await uploadStudentDocument(number, v, file, false);
};

/* reads a chosen file and stores it as a student document (shared with the student's own profile page) */
async function uploadStudentDocument(number, v, file, ownProfile) {
  if (!file) { toast("Choose a file first.", "error"); return; }
  try {
    const dataUrl = file.type.startsWith("image/") ? await compressImage(file) : await new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
    const saved = await uploadWithRetry(dataUrl, file.name, "document");
    await api(ownProfile ? "/profile/documents" : `/students/${encodeURIComponent(number)}/documents`, { method: "POST", body: { doc_type: v.doc_type, note: v.note, file_id: saved.id } });
    toast("Document added.");
    if (ownProfile) refresh(); else openStudent(number);
  } catch (error) { toast(error.message, "error"); }
}

actions["student-checkout"] = async (el) => {
  const number = el.dataset.id;
  if (!(await confirmDialog("Check this student out? The bed will be freed and the next person on the waiting list will be given the room.", { confirmText: "Check out", danger: true }))) return;

  let result;
  try {
    result = await api(`/students/${encodeURIComponent(number)}/checkout`, { method: "POST", body: {} });
  } catch (error) {
    if (error.data && error.data.needsConfirmation) {
      if (!(await confirmDialog(`${error.message}\n\nCheck out without an inspection?`, { confirmText: "Check out anyway", danger: true }))) return;
      try { result = await api(`/students/${encodeURIComponent(number)}/checkout`, { method: "POST", body: { force: true } }); }
      catch (e2) { toast(e2.message, "error"); return; }
    } else { toast(error.message, "error"); return; }
  }

  const s = result.settlement;
  closeModal("modal");
  openModal(`
    ${modalHead("Checked out")}
    <p>${esc(result.message)}</p>
    ${isRole("administrator") ? dl([["Deposit balance", money(s.balance)], ["Unpaid fines", money(s.unpaid_fines)], ["Refundable after fines", `<b>${money(s.refundable)}</b>`]]) : ""}
    ${result.waitlist_allocated ? `<p class="notice good">${result.waitlist_allocated} waiting student(s) were given rooms.</p>` : ""}
    <div class="modal-actions">${isRole("administrator") ? '<button class="btn" data-goto="fees">Settle the deposit</button>' : ""}<button class="btn ghost" data-action="close-modal">Close</button></div>`);
  refresh();
};
