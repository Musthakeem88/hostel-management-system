/* js/pages/dashboard.js  —  a different dashboard for each role */

const roomStatus = (r) => (r.under_maintenance ? "Maintenance" : Number(r.occupied) >= Number(r.capacity) ? "Full" : Number(r.occupied) > 0 ? "Occupied" : "Available");

function overdueJob(job) {
  return job.status !== "Completed" && job.expected_completion_date && job.expected_completion_date < todayISO();
}

pages.dashboard = {
  title: () => (isRole("student") ? `Hello, ${state.user.name.split(" ")[0]}` : "Dashboard"),

  async load() {
    const role = state.user.role;
    const d = { stats: await api("/dashboard") };

    if (["administrator", "warden", "management"].includes(role)) {
      [d.rooms, d.maintenance, d.repairs] = await Promise.all([api("/rooms"), api("/maintenance"), api("/repairs")]);
    }
    if (role === "student") {
      try { d.notices = (await api("/m/notices")).slice(0, 3); } catch { d.notices = []; }
    }
    state.d.dashboard = d;
  },

  render() {
    const role = state.user.role;
    if (role === "student") return studentDashboard();
    if (role === "maintenance") return maintenanceDashboard();
    if (role === "security") return securityDashboard();
    return staffDashboard();
  }
};

/* ---------- administrator, warden, management ---------- */

function attentionItems(w, f) {
  const items = [
    ["damage", f.awaiting_review ?? 0, "damage reports to review", "administrator"],
    ["applications", w.applications, "room applications waiting", "administrator", "warden"],
    ["fines", f.appeals_open, "fine appeals to decide", "administrator"],
    ["inspections", w.checkins_unconfirmed, "check-ins not yet confirmed by students", "warden", "administrator"],
    ["visitors", w.visitors, "visitors to approve", "warden", "administrator"],
    ["leaves", w.leaves, "leave requests to approve", "warden", "administrator"],
    ["transfers", w.transfers, "room transfer requests", "administrator"],
    ["complaints", w.complaints, "complaints to answer", "warden", "administrator"],
    ["incidents", w.incidents, "open incidents", "warden", "administrator"]
  ];
  return items.filter(([page, count, , ...roles]) => count > 0 && roles.includes(state.user.role) && can(page));
}

function staffDashboard() {
  const { stats: s, rooms, maintenance, repairs } = state.d.dashboard;
  const r = s.rooms;

  const blocks = {};
  rooms.forEach((room) => {
    const b = blocks[room.block] = blocks[room.block] || { cap: 0, occ: 0 };
    b.cap += Number(room.capacity);
    b.occ += Number(room.occupied);
  });
  const bars = Object.entries(blocks).map(([block, v]) => `
    <div class="bar"><span>Block ${esc(block)}</span><i style="width:${v.cap ? Math.round((v.occ / v.cap) * 100) : 0}%"></i><b>${v.occ}/${v.cap}</b></div>`).join("");

  const maxDamaged = Math.max(1, ...s.damage.most_damaged.map((m) => m.total));
  const damagedBars = s.damage.most_damaged.map((m) => `
    <div class="bar"><span>${esc(m.item)}</span><i style="width:${Math.round((m.total / maxDamaged) * 100)}%"></i><b>${m.total}</b></div>`).join("");

  const mCount = (st) => maintenance.filter((j) => j.status === st).length;
  const mOver = maintenance.filter(overdueJob).length;
  const openJobs = maintenance.filter((j) => j.status !== "Completed")
    .sort((a, b) => (a.expected_completion_date || "9999").localeCompare(b.expected_completion_date || "9999")).slice(0, 5);

  const latestRepairs = repairs.slice(0, 5);
  const attention = attentionItems(s.waiting, s.damage);

  return `
    ${attention.length ? `
      <div class="card">
        <div class="card-head"><h3>Needs your attention</h3></div>
        <div class="stats" style="margin:0">
          ${attention.map(([page, count, label]) => statCard(label, count, { warn: true, page })).join("")}
        </div>
      </div>` : ""}

    <div class="stats">
      ${statCard("Total rooms", r.total, { page: can("rooms") ? "rooms" : null })}
      ${statCard("Registered students", s.students, { page: can("students") ? "students" : null })}
      ${statCard("Available rooms", r.available)}
      ${statCard("Full rooms", r.full)}
      ${statCard("Maintenance rooms", r.under_maintenance, { warn: r.under_maintenance > 0, page: can("rooms") ? "rooms" : null })}
      ${statCard("Occupied beds", `${r.beds_used} / ${r.beds}`)}
      ${statCard("Active repairs", s.repairs.open, { page: can("repairs") ? "repairs" : null, hint: s.repairs.urgent ? `${s.repairs.urgent} urgent` : "" })}
    </div>

    <h3 class="section-title">Damage and money</h3>
    <div class="stats">
      ${statCard("Damaged items", s.items.damaged, { warn: s.items.damaged > 0, page: can("items") ? "items" : null, hint: `of ${s.items.total} items` })}
      ${statCard("Unpaid fines", money(s.fines.unpaid_amount), { warn: s.fines.overdue > 0, page: can("fines") ? "fines" : null, hint: s.fines.overdue ? `${s.fines.overdue} overdue` : `${s.fines.unpaid_count} fines` })}
      ${statCard("Fees received", money(s.fees.received), { page: can("fees") ? "fees" : null, hint: `of ${money(s.fees.invoiced)} invoiced` })}
      ${statCard("Unpaid fees", s.fees.unpaid_count, { warn: s.fees.overdue > 0, page: can("fees") ? "fees" : null, hint: s.fees.overdue ? `${s.fees.overdue} overdue` : "invoices" })}
    </div>

    <h3 class="section-title">Maintenance</h3>
    <div class="stats">
      ${statCard("Pending", mCount("Pending"), { warn: mCount("Pending") > 0 })}
      ${statCard("In progress", mCount("In Progress"))}
      ${statCard("Completed", mCount("Completed"))}
      ${statCard("Overdue", mOver, { warn: mOver > 0 })}
    </div>

    <div class="card">
      <div class="card-head"><h3>Open maintenance jobs</h3>${can("maintenance") ? '<button type="button" class="btn ghost small" data-goto="maintenance">Open maintenance page</button>' : ""}</div>
      ${tbl([
        { label: "Room", render: (j) => esc(roomLabel(j)) },
        { label: "Type", key: "maintenance_type" },
        { label: "Problem", key: "description", cls: "wrap" },
        { label: "Staff", render: (j) => (j.assigned_staff ? esc(j.assigned_staff) : '<span class="muted">Unassigned</span>') },
        { label: "Status", render: (j) => badge(j.status) },
        { label: "Expected", render: (j) => `<span class="nowrap">${fmtDate(j.expected_completion_date)}</span> ${overdueJob(j) ? '<span class="badge bad">Overdue</span>' : ""}` }
      ], openJobs, { empty: "No open maintenance jobs." })}
    </div>

    <div class="grid-2">
      <div class="card"><h3>Occupancy by block</h3>${bars || '<p class="empty">No rooms yet.</p>'}</div>
      <div class="card"><h3>Most damaged items</h3>${damagedBars || '<p class="empty">No damage reports yet.</p>'}</div>
    </div>

    <div class="card">
      <h3>Latest repair requests</h3>
      ${tbl([
        { label: "Room", render: (x) => esc(x.room_id) },
        { label: "Item", key: "item_name" },
        { label: "Priority", render: (x) => badge(x.priority) },
        { label: "Status", render: (x) => badge(x.repair_status) },
        { label: "Assigned to", render: (x) => esc(x.assigned_name || "—") }
      ], latestRepairs, { empty: "No repair requests yet." })}
    </div>`;
}

/* ---------- student ---------- */

function studentDashboard() {
  const { stats: s, notices } = state.d.dashboard;

  if (!s.linked) return `<div class="card"><div class="empty-card"><b>Your account is not linked to a student number</b>Please ask the hostel office for help.</div></div>`;

  const app = s.application;
  const banner = s.pending_confirmation
    ? `<div class="notice info"><b>Please confirm your room condition.</b> The warden recorded the condition of your room at check-in. Confirm that it is correct, or tell us what is wrong.
         <div class="row-actions"><button class="btn small" data-goto="myroom">Review & confirm</button></div></div>`
    : !s.resident
      ? `<div class="notice">${app
          ? `Your room application <b>${esc(app.application_number)}</b> is <b>${esc(app.status)}</b>${app.waitlist_position ? ` (waiting list position ${app.waitlist_position})` : ""}.`
          : "You do not have a hostel room yet."}
         <div class="row-actions"><button class="btn small" data-goto="applications">${app ? "See my application" : "Apply for a room"}</button></div></div>`
      : "";

  return `
    ${banner}
    <div class="stats">
      ${statCard("My room", esc(s.room_id || "—"), { page: "myroom", hint: s.resident ? "Living here" : (s.status || "") })}
      ${statCard("Open repair requests", s.repairs_open, { page: "repairs" })}
      ${statCard("Fines to pay", money(s.fines_amount), { warn: s.fines_overdue > 0, page: "fines", hint: s.fines_due ? `${s.fines_due} fine${s.fines_due === 1 ? "" : "s"}${s.fines_overdue ? " (overdue)" : ""}` : "None" })}
      ${statCard("Fees to pay", money(s.fees_owed), { warn: s.fees_owed > 0, page: "fees" })}
      ${statCard("Deposit balance", money(s.deposit.balance), { page: "fees" })}
    </div>

    <div class="card">
      <h3>What would you like to do?</h3>
      <div class="row-actions">
        <button class="btn" data-goto="repairs">Report a problem</button>
        <button class="btn ghost" data-goto="myroom">See my room & items</button>
        <button class="btn ghost" data-goto="fees">See my fees</button>
        <button class="btn ghost" data-goto="leaves">Ask for leave</button>
        <button class="btn ghost" data-goto="visitors">Register a visitor</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Latest notices</h3><button class="btn ghost small" data-goto="notices">All notices</button></div>
      ${notices && notices.length
        ? notices.map((n) => `<p><b>${esc(n.title)}</b> ${n.priority === "Important" ? badge("Important") : ""}<br><span class="muted">${fmtDate(n.publish_date)}</span> — ${esc(n.body.slice(0, 160))}${n.body.length > 160 ? "…" : ""}</p>`).join("")
        : '<p class="empty">No notices right now.</p>'}
    </div>`;
}

/* ---------- maintenance staff ---------- */

function maintenanceDashboard() {
  const s = state.d.dashboard.stats;
  return `
    <div class="stats">
      ${statCard("My open repair jobs", s.repairs_open, { page: "repairs" })}
      ${statCard("Urgent", s.repairs_urgent, { warn: s.repairs_urgent > 0 })}
      ${statCard("Open maintenance jobs", s.maintenance_open, { page: "maintenance" })}
      ${statCard("Repairs finished", s.repairs_done)}
    </div>
    <div class="card">
      <div class="card-head"><h3>My jobs</h3><button class="btn ghost small" data-goto="repairs">Open repairs</button></div>
      ${tbl([
        { label: "Request", key: "request_number" },
        { label: "Room", key: "room_id" },
        { label: "Item", key: "item_name" },
        { label: "Priority", render: (j) => badge(j.priority) },
        { label: "Status", render: (j) => badge(j.repair_status) },
        { label: "", render: (j) => `<button class="btn small" data-action="repair-update" data-id="${j.repair_id}">Update</button>` }
      ], s.jobs, { empty: "You have no open jobs. Nice work!" })}
    </div>`;
}

/* ---------- security ---------- */

function securityDashboard() {
  const s = state.d.dashboard.stats;
  return `
    <div class="stats">
      ${statCard("Visitors today", s.visitors_today, { page: "visitors" })}
      ${statCard("Approved, waiting at the gate", s.visitors_approved, { page: "visitors" })}
      ${statCard("Visitors inside now", s.visitors_inside, { page: "visitors" })}
      ${statCard("Students expected back", s.returns_expected, { page: "leaves", warn: s.returns_expected > 0 })}
      ${statCard("Late arrivals today", s.late_today, { page: "leaves" })}
      ${statCard("Open incidents", s.incidents_open, { page: "incidents", warn: s.incidents_open > 0 })}
    </div>
    <div class="card">
      <h3>Gate screen</h3>
      <div class="row-actions">
        <button class="btn" data-goto="visitors">Visitor log</button>
        <button class="btn ghost" data-goto="leaves">Returns & late arrivals</button>
        <button class="btn ghost" data-goto="incidents">Report an incident</button>
        <button class="btn ghost" data-goto="keys">Room keys</button>
      </div>
    </div>`;
}
