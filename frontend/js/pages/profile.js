/* js/pages/profile.js  —  my details, documents and password */

pages.profile = {
  async load() { state.d.profile = await api("/profile"); },

  render() {
    const { user, student, documents, deposit } = state.d.profile;

    return `
      <div class="grid-2">
        <div class="card">
          <h3>My details</h3>
          <form data-form="profile-save">
            <div class="stack">
              <label>Full name *<input name="full_name" required maxlength="120" value="${esc(user.full_name)}"></label>
              <label>Email<input name="email" type="email" maxlength="150" value="${esc(user.email || "")}"></label>
              <label>Phone<input name="phone" maxlength="30" value="${esc(user.phone || "")}"></label>
              ${student ? `
                <label>Faculty<input name="faculty" maxlength="120" value="${esc(student.faculty || "")}"></label>
                <label>Emergency contact<input name="emergency_contact_name" maxlength="120" value="${esc(student.emergency_contact_name || "")}"></label>
                <label>Emergency phone<input name="emergency_contact_phone" maxlength="30" value="${esc(student.emergency_contact_phone || "")}"></label>` : ""}
            </div>
            <button class="btn" type="submit" style="margin-top:14px">Save details</button>
          </form>
        </div>

        <div class="card">
          <h3>Account</h3>
          ${dl([["Username", `<span class="mono">${esc(user.username)}</span>`], ["Role", esc(state.user.roleLabel)], user.student_number ? ["Student number", esc(user.student_number)] : null,
                student ? ["Room", esc(student.room_id)] : null, student ? ["Status", badge(student.student_status || "Active")] : null])}
          <div class="row-actions" style="margin-top:12px">
            <button class="btn ghost" data-action="change-password">Change password</button>
            <button class="btn ghost danger" data-action="logout">Sign out</button>
          </div>
        </div>
      </div>

      ${student ? `
      <div class="card">
        <div class="card-head"><h3>My documents</h3><button class="btn small" data-action="my-doc">Add document</button></div>
        ${tbl([
          { label: "Type", key: "doc_type" }, { label: "Note", render: (d) => esc(d.note || "—") }, { label: "Added", render: (d) => fmtDate(String(d.created_at).slice(0, 10)) },
          { label: "", render: (d) => `<div class="row-actions"><a class="btn ghost small" href="${esc(d.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost small danger" data-action="my-doc-remove" data-id="${d.doc_id}">Remove</button></div>` }
        ], documents, { empty: "No documents yet. You can upload your offer letter or ID." })}
      </div>` : ""}`;
  }
};

forms["profile-save"] = async (form) => {
  await submitting(form, async () => {
    const ok = await attempt(() => api("/profile", { method: "PUT", body: formData(form) }));
    if (ok) { state.user.name = formData(form).full_name; $("#user-name").textContent = state.user.name; $("#avatar").textContent = state.user.name.charAt(0).toUpperCase(); }
  });
};

actions["my-doc"] = async () => {
  const v = await formModal({
    title: "Add a document",
    fields: [{ name: "doc_type", label: "Document type", type: "select", options: ["Offer letter", "ID / passport", "Medical form", "Hostel agreement", "Other"], required: true }, { name: "note", label: "Note", maxlength: 200 }],
    extra: `<label>File (photo or PDF) *<input type="file" id="doc-file" accept="image/*,application/pdf" required></label>`,
    submitText: "Upload"
  });
  if (!v) return;
  await uploadStudentDocument(state.user.studentNumber, v, $("#doc-file") && $("#doc-file").files[0], true);
};

actions["my-doc-remove"] = async (el) => {
  if (await confirmDialog("Remove this document?", { confirmText: "Remove", danger: true })) attempt(() => api(`/profile/documents/${el.dataset.id}`, { method: "DELETE" }));
};
