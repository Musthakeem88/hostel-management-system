/* js/pages/audit.js  —  activity log (who did what, and when) */

pages.audit = {
  async load() {
    const f = ui("audit", { user: "", action: "", from: "", to: "" });
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    state.d.audit = await api(`/audit?${params}`);
  },

  render() {
    const f = ui("audit");
    return `
      <form class="toolbar" data-form="audit-filter">
        <input name="user" placeholder="User" value="${esc(f.user)}" aria-label="User">
        <input name="action" placeholder="Action, e.g. fine" value="${esc(f.action)}" aria-label="Action">
        <label class="inline">From <input type="date" name="from" value="${esc(f.from)}"></label>
        <label class="inline">To <input type="date" name="to" value="${esc(f.to)}"></label>
        <button class="btn small" type="submit">Filter</button>
      </form>
      <div class="card">
        ${tbl([
          { label: "When", render: (l) => fmtTime(l.created_at) },
          { label: "User", render: (l) => esc(l.username || "—") },
          { label: "Role", render: (l) => esc(l.role || "—") },
          { label: "Action", render: (l) => `<span class="mono">${esc(l.action)}</span>` },
          { label: "About", render: (l) => esc([l.entity_type, l.entity_id].filter(Boolean).join(" ")) },
          { label: "Details", render: (l) => `<span class="muted">${esc(String(l.details || "").slice(0, 140))}</span>`, cls: "wrap" },
          { label: "IP", render: (l) => esc(l.ip || "—") }
        ], state.d.audit, { empty: "Nothing recorded for these filters." })}
        <p class="muted">Showing the latest ${state.d.audit.length} entries. Damage reports, fines, payments, sign-ins and account changes are all recorded.</p>
      </div>`;
  }
};

forms["audit-filter"] = (form) => { Object.assign(ui("audit"), formData(form)); refresh(); };
