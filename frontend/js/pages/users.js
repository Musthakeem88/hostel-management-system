/* js/pages/users.js  —  user accounts and roles (administrator) */

const ROLE_OPTIONS = () => (state.meta ? state.meta.roles : []);

function randomPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("") + "7a";
}

pages.users = {
  async load() { state.d.users = await api("/users"); },

  render() {
    const users = state.d.users;
    const f = ui("users", { role: "All", q: "" });
    const roles = ["All", ...ROLE_OPTIONS().map((r) => r.value)];
    const counts = { All: users.length };
    roles.slice(1).forEach((r) => { counts[r] = users.filter((u) => u.role === r).length; });
    const list = users.filter((u) => (f.role === "All" || u.role === f.role) && matches(u, f.q, ["username", "full_name", "email", "student_number"]));

    return `
      <div class="toolbar">
        ${filterChips("users.role", roles, f.role, counts)}
        <input class="grow" type="search" placeholder="Search users…" value="${esc(f.q)}" data-input="filter" data-filter="users.q" aria-label="Search users">
        <button class="btn" data-action="user-add">Add user</button>
      </div>
      <div class="card">
        ${tbl([
          { label: "Name", render: (u) => `${esc(u.full_name)}<br><span class="muted">${esc(u.email || "")}</span>` },
          { label: "Username", render: (u) => `<span class="mono">${esc(u.username)}</span>` },
          { label: "Role", render: (u) => badge((ROLE_OPTIONS().find((r) => r.value === u.role) || {}).label || u.role, "info") },
          { label: "Student no.", render: (u) => esc(u.student_number || "—") },
          { label: "Status", render: (u) => badge(u.status) },
          { label: "Last sign-in", render: (u) => fmtTime(u.last_login) },
          { label: "", render: (u) => `<div class="row-actions"><button class="btn ghost small" data-action="user-edit" data-id="${u.user_id}">Edit</button><button class="btn ghost small" data-action="user-reset" data-id="${u.user_id}">Reset password</button></div>` }
        ], list, { empty: "No users found." })}
      </div>`;
  }
};

const userFields = (u = {}, creating = false) => [
  ...(creating ? [{ name: "username", label: "Username", required: true, maxlength: 60, hint: "For students use the student number." }] : []),
  { name: "full_name", label: "Full name", required: true, maxlength: 120, value: u.full_name },
  { name: "role", label: "Role", type: "select", required: true, options: ROLE_OPTIONS().map((r) => ({ value: r.value, label: r.label })), value: u.role || "warden" },
  { name: "student_number", label: "Student number (students only)", maxlength: 30, value: u.student_number },
  { name: "email", label: "Email", maxlength: 150, value: u.email },
  { name: "phone", label: "Phone", maxlength: 30, value: u.phone },
  { name: "position", label: "Position (staff)", maxlength: 80, value: u.position },
  { name: "hostel", label: "Hostel (staff)", maxlength: 30, value: u.hostel },
  ...(creating ? [{ name: "password", label: "Temporary password", required: true, value: randomPassword(), hint: "Give this to the person. They must change it at first sign-in." }] : [{ name: "status", label: "Account", type: "select", options: ["Active", "Disabled"], value: u.status }])
];

actions["user-add"] = async () => {
  const v = await formModal({ title: "Add a user", fields: userFields({}, true), submitText: "Create user" });
  if (!v) return;
  const result = await attempt(() => api("/users", { method: "POST", body: v }));
  if (result) openModal(`${modalHead("User created")}<p>Give these sign-in details to ${esc(v.full_name)}:</p>${dl([["Username", esc(v.username)], ["Temporary password", `<span class="mono">${esc(v.password)}</span>`]])}<div class="modal-actions"><button class="btn" data-action="close-modal">Done</button></div>`);
};

actions["user-edit"] = async (el) => {
  const u = state.d.users.find((x) => String(x.user_id) === el.dataset.id);
  const v = await formModal({ title: `Edit ${u.full_name}`, fields: userFields(u) });
  if (v) attempt(() => api(`/users/${u.user_id}`, { method: "PUT", body: v }));
};

actions["user-reset"] = async (el) => {
  const u = state.d.users.find((x) => String(x.user_id) === el.dataset.id);
  if (!(await confirmDialog(`Reset the password for ${u.full_name}? They will have to choose a new one at next sign-in.`, { confirmText: "Reset password", danger: true }))) return;
  try {
    const r = await api(`/users/${u.user_id}/reset-password`, { method: "POST", body: {} });
    openModal(`${modalHead("Password reset")}<p>Give this temporary password to ${esc(u.full_name)}:</p><div class="pw-box">${esc(r.temporary_password)}</div><div class="modal-actions"><button class="btn" data-action="close-modal">Done</button></div>`);
  } catch (error) { toast(error.message, "error"); }
};
