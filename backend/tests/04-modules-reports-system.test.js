const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { boot, campus } = require("./helpers");
const { today, addDays } = require("../lib/validate");

let t;
let k;

before(async () => { t = await boot(); k = await campus(t); });
after(async () => { await t.close(); });

const m = (method, key, body, token, suffix = "") => t.call(method, `/api/m/${key}${suffix}`, body, token);
const notes = async (token) => (await t.call("GET", "/api/notifications", undefined, token)).data.map((n) => n.title);

describe("what each role can see (meta)", () => {
  test("modules are filtered by role and describe their own forms and buttons", async () => {
    const guard = (await t.call("GET", "/api/meta", undefined, k.guard)).data.modules;
    assert.deepEqual(Object.keys(guard).sort(), ["incidents", "keys", "leaves", "lostfound", "notices", "visitors"].sort());
    const ann = (await t.call("GET", "/api/meta", undefined, k.ann)).data.modules;
    assert.ok(ann.visitors.scoped && ann.visitors.canCreate);
    assert.equal(ann.notices.canCreate, false);
    assert.equal(ann.utilities, undefined);
    const warden = (await t.call("GET", "/api/meta", undefined, k.warden)).data.modules;
    assert.ok(warden.visitors.actions.some((a) => a.key === "approve"));
    assert.ok(!guard.visitors.actions.some((a) => a.key === "approve"));
    assert.equal((await t.call("GET", "/api/m/visitors", undefined, k.boss)).status, 403);
    assert.equal((await t.call("GET", "/api/m/nothing", undefined, k.admin)).status, 404);
  });
});

describe("visitors", () => {
  let id;
  test("a student pre-registers a visitor; approval, then the gate checks them in and out", async () => {
    assert.equal((await m("POST", "visitors", { visitor_name: "" }, k.ann)).status, 400);
    const c = await m("POST", "visitors", { student_number: "20260002", visitor_name: "Mr Lee", relationship: "Parent", purpose: "Bring clothes", visit_date: today() }, k.ann);
    assert.equal(c.status, 201);
    id = c.data.row.visitor_id;
    assert.equal(c.data.row.student_number, "20260001");         // forced to the student's own number
    assert.equal(c.data.row.status, "Pending");
    assert.ok((await notes(k.warden)).includes("Visitor waiting for approval"));

    assert.equal((await m("POST", "visitors", {}, k.guard, `/${id}/check_in`)).status, 409);         // not approved yet
    assert.equal((await m("POST", "visitors", {}, k.guard, `/${id}/approve`)).status, 403);          // guard cannot approve
    assert.equal((await m("POST", "visitors", {}, k.ann, `/${id}/approve`)).status, 403);
    assert.equal((await m("POST", "visitors", {}, k.warden, `/${id}/approve`)).status, 200);
    assert.ok((await notes(k.ann)).includes("Visitor approved"));
    const inn = await m("POST", "visitors", {}, k.guard, `/${id}/check_in`);
    assert.equal(inn.data.row.status, "Checked in");
    assert.ok(inn.data.row.time_in);
    assert.equal((await m("POST", "visitors", {}, k.guard, `/${id}/check_in`)).status, 409);
    const out = await m("POST", "visitors", {}, k.guard, `/${id}/check_out`);
    assert.equal(out.data.row.status, "Checked out");
    assert.ok(out.data.row.time_out);
  });

  test("security logs walk-ins; wardens' own entries are approved at once; students only see their own", async () => {
    const walk = await m("POST", "visitors", { student_number: "20260002", visitor_name: "Walk In", visit_date: today() }, k.guard);
    assert.equal(walk.data.row.status, "Pending");
    assert.equal((await m("POST", "visitors", { student_number: "20269999", visitor_name: "X", visit_date: today() }, k.guard)).status, 400);   // unknown student
    const w = await m("POST", "visitors", { student_number: "20260002", visitor_name: "Warden Added", visit_date: today() }, k.warden);
    assert.equal(w.data.row.status, "Approved");
    assert.equal((await m("GET", "visitors", undefined, k.ann)).data.length, 1);
    assert.equal((await m("GET", "visitors", undefined, k.guard)).data.length, 3);
    assert.equal((await m("GET", "visitors?status=Pending", undefined, k.guard)).data.length, 1);
    assert.equal((await m("POST", "visitors", { student_number: "20260001", visitor_name: "Y", visit_date: "31-12-2026" }, k.guard)).status, 400);
  });
});

describe("leave and late return", () => {
  test("students ask permission; leave dates are checked; students cannot log late arrivals", async () => {
    const base = { leave_type: "Weekend", reason: "Going home", destination: "Penang", leave_from: today(), leave_to: today() };
    assert.equal((await m("POST", "leaves", { ...base, leave_to: addDays(today(), -1) }, k.ann)).status, 400);
    assert.equal((await m("POST", "leaves", { ...base, leave_type: "Late arrival" }, k.ann)).status, 400);
    assert.equal((await m("POST", "leaves", { ...base, return_time: "25:99" }, k.ann)).status, 400);
    const c = await m("POST", "leaves", { ...base, return_time: "23:59" }, k.ann);
    assert.equal(c.status, 201);
    assert.equal(c.data.row.status, "Pending");
    assert.ok((await notes(k.warden)).includes("Leave request waiting"));

    const id = c.data.row.leave_id;
    assert.equal((await m("POST", "leaves", {}, k.warden, `/${id}/reject`)).status, 400);              // reason needed
    assert.equal((await m("POST", "leaves", {}, k.guard, `/${id}/returned`)).status, 409);             // not approved yet
    assert.equal((await m("POST", "leaves", { decision_note: "Enjoy" }, k.warden, `/${id}/approve`)).status, 200);
    assert.ok((await notes(k.ann)).includes("Leave approved"));
    assert.equal((await m("POST", "leaves", {}, k.guard, `/${id}/depart`)).data.row.status, "Departed");
    const back = await m("POST", "leaves", {}, k.guard, `/${id}/returned`);
    assert.equal(back.data.row.status, "Returned");           // before 23:59 on the approved day
    assert.ok(back.data.row.returned_at);
  });

  test("coming back after the approved date is recorded as late and the warden is told", async () => {
    // an approved leave that ended yesterday
    const rows = await t.pool.query(
      `INSERT INTO leave_requests (student_number, leave_type, reason, leave_from, leave_to, status, created_at)
       VALUES ('20260002', 'Home visit', 'Family', $1, $2, 'Approved', CURRENT_TIMESTAMP) RETURNING leave_id`, [addDays(today(), -3), addDays(today(), -1)]);
    const id = rows.rows[0].leave_id;
    const back = await m("POST", "leaves", {}, k.guard, `/${id}/returned`);
    assert.equal(back.data.row.status, "Returned late");
    assert.equal(back.data.result.late, true);
    assert.ok((await notes(k.warden)).includes("Late return"));
  });

  test("security can record a late arrival for a student who had no permission", async () => {
    const r = await m("POST", "leaves", { student_number: "20260002", leave_type: "Late arrival", reason: "Arrived at 01:30", leave_from: today(), leave_to: today() }, k.guard);
    assert.equal(r.status, 201);
    assert.equal(r.data.row.status, "Returned late");
    assert.ok(r.data.row.returned_at);
    assert.ok((await notes(k.warden)).includes("Late arrival recorded"));
  });
});

describe("room transfer", () => {
  let id;
  test("a student asks to move; the administrator moves them and counts stay right", async () => {
    const c = await m("POST", "transfers", { preferred_block: "B", reason: "Noisy roommate" }, k.ann);
    assert.equal(c.status, 201);
    id = c.data.row.transfer_id;
    assert.equal(c.data.row.from_room, "A-01-01");
    assert.equal((await m("POST", "transfers", { reason: "Again" }, k.ann)).status, 409);          // one pending request at a time
    assert.ok((await notes(k.admin)).includes("Room transfer waiting"));

    assert.equal((await m("POST", "transfers", { to_room: "B-01-01" }, k.warden, `/${id}/approve`)).status, 403);
    assert.equal((await m("POST", "transfers", {}, k.admin, `/${id}/approve`)).status, 400);       // new room needed
    assert.equal((await m("POST", "transfers", { to_room: "A-01-01" }, k.admin, `/${id}/approve`)).status, 400);   // same room
    assert.equal((await m("POST", "transfers", { to_room: "Z-09-09" }, k.admin, `/${id}/approve`)).status, 400);   // no such room

    const ok = await m("POST", "transfers", { to_room: "B-01-01", decision_note: "Approved" }, k.admin, `/${id}/approve`);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.row.status, "Completed");
    assert.equal(ok.data.row.to_room, "B-01-01");

    const rooms = (await t.call("GET", "/api/rooms", undefined, k.admin)).data;
    assert.equal(rooms.find((r) => r.room_id === "A-01-01").occupied, 1);
    assert.equal(rooms.find((r) => r.room_id === "B-01-01").occupied, 1);
    assert.equal((await t.call("GET", "/api/students/20260001", undefined, k.warden)).data.student.room_block, "B");
    const beds = (await t.call("GET", "/api/rooms/B-01-01/detail", undefined, k.warden)).data.beds;
    assert.ok(beds.some((b) => b.student_number === "20260001"));
    assert.ok((await notes(k.ann)).includes("Room transfer approved"));
    assert.ok((await t.call("GET", "/api/maintenance", undefined, k.warden)).data.some((j) => j.room_block === "B" && j.maintenance_type === "Cleaning"));
    assert.equal((await m("POST", "transfers", { to_room: "B-01-01" }, k.admin, `/${id}/approve`)).status, 409);   // already done
  });

  test("a transfer can be declined with a reason, and a full room is refused", async () => {
    const c = await m("POST", "transfers", { reason: "Want a quieter floor" }, k.ben);
    const id2 = c.data.row.transfer_id;
    assert.equal((await m("POST", "transfers", {}, k.admin, `/${id2}/reject`)).status, 400);                    // reason needed
    assert.equal((await m("POST", "transfers", { decision_note: "No free single rooms yet" }, k.admin, `/${id2}/reject`)).status, 200);
    assert.ok((await notes(k.ben)).includes("Room transfer declined"));

    // Ben takes the single room A-01-02, which is then full for everyone else
    const again = await m("POST", "transfers", { reason: "Need a single room for exams" }, k.ben);
    assert.equal((await m("POST", "transfers", { to_room: "A-01-02" }, k.admin, `/${again.data.row.transfer_id}/approve`)).status, 200);
    const ann = await m("POST", "transfers", { reason: "I would like the single room too" }, k.ann);
    const full = await m("POST", "transfers", { to_room: "A-01-02" }, k.admin, `/${ann.data.row.transfer_id}/approve`);
    assert.equal(full.status, 400);
    assert.match(full.data.error, /full/i);
    assert.equal((await t.call("GET", "/api/students/20260001", undefined, k.warden)).data.student.room_block, "B");   // Ann did not move
    assert.equal((await m("POST", "transfers", { decision_note: "Room is full" }, k.admin, `/${ann.data.row.transfer_id}/reject`)).status, 200);
  });
});

describe("complaints, notices, keys, incidents, lost and found, utilities", () => {
  test("complaints: private to the student, answered by wardens", async () => {
    assert.equal((await m("POST", "complaints", { category: "Rant", subject: "x", message: "y" }, k.ann)).status, 400);
    const c = await m("POST", "complaints", { category: "Complaint", subject: "Hot water", message: "No hot water on floor 1" }, k.ann);
    assert.equal(c.status, 201, JSON.stringify(c.data));
    assert.equal(c.status, 201);
    assert.equal((await m("GET", "complaints", undefined, k.ben)).data.length, 0);
    assert.equal((await m("POST", "complaints", { category: "Feedback", subject: "x", message: "y" }, k.warden)).status, 403);
    const id = c.data.row.complaint_id;
    assert.equal((await m("POST", "complaints", {}, k.warden, `/${id}/respond`)).status, 400);
    const r = await m("POST", "complaints", { response: "The heater was repaired today." }, k.warden, `/${id}/respond`);
    assert.equal(r.data.row.status, "Resolved");
    assert.ok((await notes(k.ann)).includes("Reply to your message"));
    assert.equal((await m("POST", "complaints", { response: "again" }, k.warden, `/${id}/respond`)).status, 409);
  });

  test("notices go to the right audience, can be edited and archived", async () => {
    assert.equal((await m("POST", "notices", { title: "T", body: "B" }, k.ann)).status, 403);
    assert.equal((await m("POST", "notices", { title: "Bad", body: "dates", publish_date: today(), expires_date: addDays(today(), -2) }, k.warden)).status, 400);
    const students = await m("POST", "notices", { title: "Exam week quiet hours", body: "Please keep the noise down after 10pm.", audience: "Students", priority: "Important" }, k.warden);
    assert.equal(students.status, 201);
    const everyone = await m("POST", "notices", { title: "Water cut Sunday", body: "Planned water cut 9am-1pm.", audience: "All" }, k.admin);
    await m("POST", "notices", { title: "Staff meeting", body: "Friday 3pm", audience: "Staff" }, k.admin);

    assert.deepEqual((await m("GET", "notices", undefined, k.ann)).data.map((n) => n.title).sort(), ["Exam week quiet hours", "Water cut Sunday"]);
    assert.deepEqual((await m("GET", "notices", undefined, k.guard)).data.map((n) => n.title).sort(), ["Staff meeting", "Water cut Sunday"]);
    assert.equal((await m("GET", "notices", undefined, k.warden)).data.length, 3);
    assert.ok((await notes(k.ann)).includes("Notice: Exam week quiet hours"));                     // important -> notification

    assert.equal((await m("PUT", "notices", { title: "Water cut moved to Monday" }, k.warden, `/${everyone.data.row.notice_id}`)).status, 200);
    assert.equal((await m("PUT", "notices", { title: "x" }, k.ann, `/${everyone.data.row.notice_id}`)).status, 403);
    assert.equal((await m("POST", "notices", {}, k.warden, `/${everyone.data.row.notice_id}/archive`)).status, 200);
    assert.equal((await m("GET", "notices", undefined, k.ann)).data.length, 1);
    assert.equal((await m("POST", "notices", {}, k.warden, `/${everyone.data.row.notice_id}/publish`)).status, 200);
  });

  test("keys: one holder at a time, returns and losses are tracked", async () => {
    const c = await m("POST", "keys", { room: "A-01-01", key_number: "K-101", student_number: "20260002" }, k.guard);
    assert.equal(c.status, 201);
    assert.equal(c.data.row.room_id, "A-01-01");
    assert.equal((await m("POST", "keys", { room: "A-01-01", key_number: "K-101" }, k.guard)).status, 409);
    assert.equal((await m("POST", "keys", { room: "A-01-01", key_number: "K-102" }, k.ann)).status, 403);
    const id = c.data.row.key_id;
    assert.equal((await m("POST", "keys", {}, k.guard, `/${id}/return`)).data.row.status, "Returned");
    assert.equal((await m("POST", "keys", {}, k.guard, `/${id}/lost`)).status, 409);
    const second = await m("POST", "keys", { room: "A-01-02", key_number: "K-201" }, k.warden);
    assert.equal((await m("POST", "keys", {}, k.warden, `/${second.data.row.key_id}/lost`)).status, 200);
    assert.ok((await notes(k.admin)).includes("Room key lost"));
  });

  test("incidents: serious ones alert wardens and administrators immediately", async () => {
    assert.equal((await m("POST", "incidents", { incident_type: "Fire", severity: "Extreme", description: "x" }, k.guard)).status, 400);
    const c = await m("POST", "incidents", { incident_type: "Fire", severity: "Critical", location: "Block A kitchen", room: "A-01-01", description: "Smoke from the pantry" }, k.guard);
    assert.equal(c.status, 201);
    assert.ok((await notes(k.admin)).some((x) => x.startsWith("CRITICAL incident")));
    assert.ok((await notes(k.warden)).some((x) => x.startsWith("CRITICAL incident")));
    const id = c.data.row.incident_id;
    assert.equal((await m("POST", "incidents", {}, k.guard, `/${id}/resolve`)).status, 403);
    assert.equal((await m("POST", "incidents", {}, k.warden, `/${id}/resolve`)).status, 400);       // action taken is required
    assert.equal((await m("POST", "incidents", { action_taken: "Called the fire brigade" }, k.warden, `/${id}/investigate`)).status, 200);
    const done = await m("POST", "incidents", { action_taken: "Fire put out, no injuries" }, k.warden, `/${id}/resolve`);
    assert.equal(done.data.row.status, "Resolved");
    assert.ok(done.data.row.resolved_at);
    assert.equal((await m("GET", "incidents", undefined, k.ann)).status, 403);
  });

  test("lost and found: students see only their own reports", async () => {
    const c = await m("POST", "lostfound", { kind: "Lost", item_name: "Blue water bottle", location: "Study room" }, k.ann);
    assert.equal(c.status, 201);
    assert.equal(c.data.row.student_number, "20260001");
    await m("POST", "lostfound", { kind: "Found", item_name: "Keys on a red lanyard", location: "Gate" }, k.guard);
    assert.equal((await m("GET", "lostfound", undefined, k.ann)).data.length, 1);
    assert.equal((await m("GET", "lostfound", undefined, k.guard)).data.length, 2);
    assert.equal((await m("POST", "lostfound", { resolution_note: "Collected by owner" }, k.guard, `/${c.data.row.item_id}/claim`)).data.row.status, "Claimed");
    assert.equal((await m("POST", "lostfound", {}, k.ann, `/${c.data.row.item_id}/close`)).status, 403);
  });

  test("utilities: consumption is worked out from the previous reading", async () => {
    const first = await m("POST", "utilities", { block: "A", utility: "Electricity", reading_date: "2026-09-01", reading_value: 1000, cost: 0 }, k.admin);
    assert.equal(first.status, 201);
    assert.equal(first.data.row.consumption, null);
    assert.equal(first.data.row.unit, "kWh");
    const second = await m("POST", "utilities", { block: "A", utility: "Electricity", reading_date: "2026-10-01", reading_value: 1250.5, cost: 180 }, k.admin);
    assert.equal(second.data.row.consumption, 250.5);
    assert.equal((await m("POST", "utilities", { block: "A", utility: "Electricity", reading_date: "2026-11-01", reading_value: 100 }, k.admin)).status, 400);   // lower than before
    assert.equal((await m("POST", "utilities", { block: "Q", utility: "Water", reading_date: "2026-10-01", reading_value: 5 }, k.admin)).status, 400);          // no such hostel
    assert.equal((await m("POST", "utilities", { block: "A", utility: "Water", reading_date: "2026-10-01", reading_value: 12 }, k.warden)).status, 403);
    assert.equal((await m("GET", "utilities", undefined, k.boss)).data.length, 2);
    assert.equal((await m("GET", "utilities", undefined, k.guard)).status, 403);
  });
});

describe("reports and exports", () => {
  test("every role gets only its own reports", async () => {
    const wardenList = (await t.call("GET", "/api/reports", undefined, k.warden)).data.map((r) => r.key);
    assert.ok(wardenList.includes("occupancy") && !wardenList.includes("fines_fees") && !wardenList.includes("monthly"));
    const adminList = (await t.call("GET", "/api/reports", undefined, k.admin)).data.map((r) => r.key);
    for (const key of ["occupancy", "allocation", "items", "damage", "repairs", "fines_fees", "unpaid", "replacement", "monthly"]) assert.ok(adminList.includes(key), key);
    assert.equal((await t.call("GET", "/api/reports/fines_fees", undefined, k.warden)).status, 403);
    assert.equal((await t.call("GET", "/api/reports/occupancy", undefined, k.ann)).status, 403);
    assert.equal((await t.call("GET", "/api/reports/nothing", undefined, k.admin)).status, 404);
    assert.equal((await t.call("GET", "/api/reports/occupancy?format=docx", undefined, k.admin)).status, 400);
  });

  test("all nine reports run and give sensible numbers", async () => {
    const occ = (await t.call("GET", "/api/reports/occupancy", undefined, k.admin)).data;
    assert.equal(occ.rows.length, 3);
    assert.equal(occ.summary.find((s) => s.label === "Beds").value, 5);
    assert.equal((await t.call("GET", "/api/reports/occupancy?block=A", undefined, k.admin)).data.rows.length, 2);
    assert.equal((await t.call("GET", "/api/reports/allocation", undefined, k.admin)).data.rows.length, 2);
    const items = (await t.call("GET", "/api/reports/items?block=B", undefined, k.admin)).data;
    assert.equal(items.rows.length, 19);
    for (const key of ["damage", "repairs", "fines_fees", "unpaid", "replacement"]) {
      const r = await t.call("GET", `/api/reports/${key}`, undefined, k.admin);
      assert.equal(r.status, 200, key);
      assert.ok(Array.isArray(r.data.rows) && Array.isArray(r.data.columns), key);
    }
    const unpaid = (await t.call("GET", "/api/reports/unpaid", undefined, k.boss)).data;
    assert.ok(unpaid.rows.length >= 4);                                                         // deposits + hostel fees
    assert.equal(unpaid.summary.find((s) => s.label === "Total owed").value, "RM 3000.00");   // 2 residents x (300 deposit + 1200 hostel fee)
  });

  test("the monthly summary can be made for any month", async () => {
    const month = today().slice(0, 7);
    const r = (await t.call("GET", `/api/reports/monthly?month=${month}`, undefined, k.boss)).data;
    const row = (name) => r.rows.find((x) => x.metric === name).value;
    assert.equal(row("New residents (check-in)"), 2);
    assert.equal(row("Visitors"), 3);
    assert.equal(row("Incidents reported"), 1);
    assert.match(row("Occupancy now"), /beds/);
  });

  test("PDF and Excel downloads are real files", async () => {
    const pdf = await t.call("GET", "/api/reports/occupancy?format=pdf", undefined, k.warden);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.from(pdf.data).subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.headers.get("content-disposition"), /occupancy-\d{4}-\d{2}-\d{2}\.pdf/);
    const xlsx = await t.call("GET", "/api/reports/items?format=xlsx", undefined, k.admin);
    assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
    assert.equal(Buffer.from(xlsx.data).subarray(0, 2).toString(), "PK");
    require("fs").writeFileSync("/tmp/test-report.xlsx", Buffer.from(xlsx.data));
    require("fs").writeFileSync("/tmp/test-report.pdf", Buffer.from(pdf.data));
    assert.ok((await t.call("GET", "/api/audit?action=export", undefined, k.admin)).data.length >= 2);
  });
});

describe("search, notifications, dashboards", () => {
  test("search finds students, rooms and items for staff only", async () => {
    assert.equal((await t.call("GET", "/api/search?q=a", undefined, k.warden)).status, 400);
    assert.equal((await t.call("GET", "/api/search?q=Ann", undefined, k.ann)).status, 403);
    const r = (await t.call("GET", "/api/search?q=Ann", undefined, k.warden)).data;
    assert.equal(r.groups.find((g) => g.type === "student").results[0].key, "20260001");
    const rooms = (await t.call("GET", "/api/search?q=B-01", undefined, k.warden)).data;
    assert.ok(rooms.groups.some((g) => g.type === "room"));
    const items = (await t.call("GET", "/api/search?q=CH-A101", undefined, k.admin)).data;
    assert.ok(items.groups.find((g) => g.type === "item").results.length >= 1);
  });

  test("notifications can be counted, read one by one or all at once", async () => {
    const before = (await t.call("GET", "/api/notifications/count", undefined, k.ann)).data.unread;
    assert.ok(before > 0);
    const list = (await t.call("GET", "/api/notifications?unread=1", undefined, k.ann)).data;
    assert.equal((await t.call("POST", `/api/notifications/${list[0].notification_id}/read`, {}, k.ann)).status, 200);
    assert.equal((await t.call("POST", `/api/notifications/${list[0].notification_id}/read`, {}, k.ben)).status, 404);   // someone else's
    assert.equal((await t.call("GET", "/api/notifications/count", undefined, k.ann)).data.unread, before - 1);
    await t.call("POST", "/api/notifications/read-all", {}, k.ann);
    assert.equal((await t.call("GET", "/api/notifications/count", undefined, k.ann)).data.unread, 0);
    assert.equal((await t.call("GET", "/api/auth/me", undefined, k.ann)).data.unread, 0);
  });

  test("each role gets its own dashboard", async () => {
    const student = (await t.call("GET", "/api/dashboard", undefined, k.ann)).data;
    assert.equal(student.role, "student");
    assert.equal(student.room_id, "B-01-01");
    assert.equal(student.fees_owed, 1500);
    const tech = (await t.call("GET", "/api/dashboard", undefined, k.tech)).data;
    assert.equal(tech.role, "maintenance");
    assert.ok("repairs_open" in tech && Array.isArray(tech.jobs));
    const guard = (await t.call("GET", "/api/dashboard", undefined, k.guard)).data;
    assert.equal(guard.visitors_today, 3);
    assert.equal(guard.incidents_open, 0);
    const admin = (await t.call("GET", "/api/dashboard", undefined, k.admin)).data;
    assert.equal(admin.rooms.total, 3);
    assert.equal(admin.students, 2);
    assert.ok("waiting" in admin && "fines" in admin && "fees" in admin);
    assert.equal((await t.call("GET", "/api/dashboard", undefined, k.boss)).status, 200);
  });
});

describe("settings, scheduled jobs and monitoring", () => {
  test("administrators can change fees and rules; bad values are refused", async () => {
    assert.equal((await t.call("GET", "/api/system/settings", undefined, k.warden)).status, 403);
    assert.equal((await t.call("PUT", "/api/system/settings", { deposit_amount: "-5" }, k.admin)).status, 400);
    assert.equal((await t.call("PUT", "/api/system/settings", { late_return_time: "9pm" }, k.admin)).status, 400);
    assert.equal((await t.call("PUT", "/api/system/settings", { fine_due_days: 400 }, k.admin)).status, 400);
    assert.equal((await t.call("PUT", "/api/system/settings", { deposit_amount: "450", hostel_fee_amount: "900" }, k.admin)).status, 200);
    // a newly allocated student is invoiced with the new amounts
    await t.call("POST", "/api/rooms", { block: "C", floor: 1, room_number: 1, capacity: 1 }, k.admin);
    await t.call("POST", "/api/students", { student_number: "20269001", full_name: "New Kid", email: "kid@uni.edu", room_block: "C", room_floor: 1, room_number: 1 }, k.warden);
    const fees = (await t.call("GET", "/api/fees?student_number=20269001", undefined, k.admin)).data;
    assert.deepEqual(fees.map((f) => f.amount).sort((a, b) => a - b), [450, 900]);
  });

  test("daily checks remind about late payments once, not over and over", async () => {
    await t.call("POST", "/api/fees", { scope: "student", student_number: "20260002", fee_type: "Other", amount: 40, due_date: addDays(today(), -5), description: "Late fee test" }, k.admin);
    const run1 = await t.call("POST", "/api/system/run-daily", {}, k.admin);
    assert.equal(run1.status, 200);
    assert.ok(run1.data.reminders >= 1);
    assert.ok((await notes(k.ben)).includes("Payment overdue"));
    const count = () => notes(k.ben).then((n) => n.filter((x) => x === "Payment overdue").length);
    const first = await count();
    await t.call("POST", "/api/system/run-daily", {}, k.admin);
    assert.equal(await count(), first);                                    // no duplicate the same week
    assert.equal((await t.call("POST", "/api/system/run-daily", {}, k.warden)).status, 403);
  });

  test("the monthly report is created, stored and announced to management", async () => {
    const r = await t.call("POST", "/api/system/run-monthly", { month: "2026-09" }, k.admin);
    assert.equal(r.status, 200);
    assert.equal(r.data.period, "2026-09");
    assert.equal((await t.call("POST", "/api/system/run-monthly", { month: "09-2026" }, k.admin)).status, 400);
    assert.ok((await notes(k.boss)).includes("Monthly report 2026-09 is ready"));
    const archive = (await t.call("GET", "/api/reports/archive", undefined, k.boss)).data;
    assert.equal(archive[0].period, "2026-09");
    const file = await t.call("GET", archive[0].url);
    assert.equal(file.status, 200);
    assert.equal(Buffer.from(file.data).subarray(0, 5).toString(), "%PDF-");
    assert.equal((await t.call("GET", "/api/reports/archive", undefined, k.warden)).status, 403);
  });

  test("status and Prometheus metrics are available", async () => {
    const s = (await t.call("GET", "/api/system/status", undefined, k.admin)).data;
    assert.equal(s.database, "ok");
    assert.equal(s.last_monthly_run, "2026-09");
    const text = (await t.call("GET", "/metrics")).data;
    assert.match(text, /hostel_http_requests_total\{method="GET",route="\/api\/dashboard",status="200"\} \d+/);
    assert.match(text, /hostel_http_request_duration_seconds_bucket/);
    assert.match(text, /hostel_db_up 1/);
    assert.match(text, /hostel_beds_total \d+/);
  });

  test("health stays public", async () => {
    const h = await t.call("GET", "/api/health");
    assert.equal(h.status, 200);
    assert.equal(h.data.success, true);
  });
});
