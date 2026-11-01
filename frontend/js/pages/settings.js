/* js/pages/settings.js  —  fees and rules, hostels, scheduled jobs and system status (administrator) */

pages.settings = {
  async load() {
    const [settings, status, hostels] = await Promise.all([api("/system/settings"), api("/system/status"), api("/hostels")]);
    state.d.settings = { settings, status, hostels };
  },

  render() {
    const { settings, status, hostels } = state.d.settings;
    const inputType = (s) => (s.type === "money" || s.type === "days" ? 'type="number" min="0" step="' + (s.type === "money" ? "0.01" : "1") + '"' : 'type="text" pattern="([01]\\d|2[0-3]):[0-5]\\d" placeholder="22:00"');

    return `
      <div class="grid-2">
        <div class="card">
          <h3>Fees and rules</h3>
          <form data-form="settings-save">
            <div class="stack">
              ${settings.map((s) => `<label>${esc(s.label)}<input name="${esc(s.key)}" ${inputType(s)} value="${esc(s.value)}" required></label>`).join("")}
            </div>
            <button class="btn" type="submit" style="margin-top:14px">Save settings</button>
          </form>
          <p class="muted">New students are invoiced with these amounts when they are given a room.</p>
        </div>

        <div class="card">
          <h3>System</h3>
          ${dl([
            ["Database", badge(status.database === "ok" ? "Active" : "Disabled", status.database === "ok" ? "good" : "bad")],
            ["File storage", esc(status.storage)], ["Scheduled jobs", esc(status.scheduler)],
            ["Last daily checks", esc(status.last_daily_run)], ["Last monthly report", esc(status.last_monthly_run)],
            ["Student sign-up", status.student_signup ? "On" : "Off"], ["Server running for", `${Math.floor(status.uptime_seconds / 3600)} h ${Math.floor((status.uptime_seconds % 3600) / 60)} min`]
          ])}
          <div class="row-actions" style="margin-top:12px">
            <button class="btn ghost small" data-action="run-daily">Run daily checks now</button>
            <button class="btn ghost small" data-action="run-monthly">Make a monthly report</button>
          </div>
          <p class="muted">Daily checks send reminders for payments, fines, late maintenance and students who have not returned.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Hostels</h3><button class="btn small" data-action="hostel-add">Add hostel</button></div>
        ${tbl([
          { label: "Block", key: "block" }, { label: "Name", key: "name" }, { label: "For", render: (h) => esc(h.gender || "—") },
          { label: "Rooms", key: "rooms", num: true }, { label: "Beds", key: "beds", num: true }, { label: "Beds free", key: "available_beds", num: true }
        ], hostels, { empty: "No hostels yet. Add a room to create one." })}
      </div>`;
  }
};

forms["settings-save"] = async (form) => {
  await submitting(form, () => attempt(() => api("/system/settings", { method: "PUT", body: formData(form) })));
};

actions["run-daily"] = () => attempt(() => api("/system/run-daily", { method: "POST", body: {} }));

actions["run-monthly"] = async () => {
  const v = await formModal({
    title: "Make a monthly report",
    fields: [{ name: "month", label: "Month (YYYY-MM)", required: true, value: addDaysISO(todayISO(), -28).slice(0, 7), maxlength: 7 }],
    submitText: "Create"
  });
  if (v) attempt(() => api("/system/run-monthly", { method: "POST", body: { month: v.month } }));
};

actions["hostel-add"] = async () => {
  const v = await formModal({
    title: "Add a hostel",
    fields: [
      { name: "block", label: "Block code", required: true, maxlength: 10, hint: "A short code such as A or B." },
      { name: "name", label: "Name", required: true, maxlength: 100, placeholder: "Block A" },
      { name: "gender", label: "For", type: "select", options: ["Male", "Female", "Mixed"], blank: "Not set" }
    ]
  });
  if (v) attempt(() => api("/hostels", { method: "POST", body: v }));
};
