const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { boot, campus } = require("./helpers");

let t;
let k;

before(async () => { t = await boot(); k = await campus(t); });
after(async () => { await t.close(); });

const staffId = async (name) => (await t.call("GET", "/api/users/directory", undefined, k.warden)).data.find((u) => u.full_name === name).user_id;

describe("repair requests", () => {
  let repairId;

  test("a student reports a problem in their own room, with a photo and a priority", async () => {
    assert.equal((await t.call("POST", "/api/repairs", { item_name: "Ceiling fan", description: "Fan is noisy", priority: "High" }, k.ann)).status, 400);
    assert.equal((await t.call("POST", "/api/repairs", { item_name: "", description: "x" }, k.ann)).status, 400);

    const r = await t.call("POST", "/api/repairs", { item_name: "Ceiling fan", description: "Fan wobbles and is noisy", priority: "Low", photo_ids: [await t.photo(k.ann)], room_id: "B-01-01" }, k.ann);
    assert.equal(r.status, 201);
    repairId = r.data.repair.repair_id;
    assert.equal(r.data.repair.room_id, "A-01-01");           // the room comes from the student's allocation, not the form
    assert.equal(r.data.repair.student_number, "20260001");
    assert.equal(r.data.repair.priority, "Low");
    assert.equal(r.data.repair.photo_count, 1);
    assert.equal(r.data.repair.repair_status, "Reported");
    assert.ok(r.data.repair.property_id, "linked to the fan in the room's item list");
  });

  test("wardens are told; students only see their own requests", async () => {
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.warden)).data.some((n) => n.title === "New repair request"));
    assert.equal((await t.call("GET", "/api/repairs", undefined, k.ann)).data.length, 1);
    assert.equal((await t.call("GET", "/api/repairs", undefined, k.ben)).data.length, 0);
    assert.equal((await t.call("GET", `/api/repairs/${repairId}`, undefined, k.ben)).status, 403);
    assert.equal((await t.call("POST", `/api/repairs/${repairId}/photos`, { photo_ids: [await t.photo(k.ben)] }, k.ben)).status, 403);
    assert.equal((await t.call("POST", `/api/repairs/${repairId}/photos`, { photo_ids: [await t.photo(k.ann)] }, k.ann)).status, 201);
    assert.equal((await t.call("GET", `/api/repairs/${repairId}`, undefined, k.ann)).data.photos.length, 2);
  });

  test("the warden assigns the job; only the assigned technician sees and updates it", async () => {
    assert.equal((await t.call("POST", `/api/repairs/${repairId}/assign`, { user_id: 1 }, k.warden)).status, 400);   // not maintenance staff
    assert.equal((await t.call("POST", `/api/repairs/${repairId}/assign`, { user_id: await staffId("Tom Tech") }, k.ann)).status, 403);
    const a = await t.call("POST", `/api/repairs/${repairId}/assign`, { user_id: await staffId("Tom Tech") }, k.warden);
    assert.equal(a.status, 200);

    assert.equal((await t.call("GET", "/api/repairs", undefined, k.tech)).data.length, 1);
    assert.equal((await t.call("GET", "/api/repairs", undefined, k.tech2)).data.length, 0);
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.tech)).data.some((n) => n.title === "New repair job"));
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.ann)).data.some((n) => n.title === "Your repair request was assigned"));
    assert.equal((await t.call("PATCH", `/api/repairs/${repairId}/status`, { status: "In Progress" }, k.tech2)).status, 403);
    assert.equal((await t.call("PATCH", `/api/repairs/${repairId}/status`, { status: "Nonsense" }, k.tech)).status, 400);
  });

  test("progress is tracked, the cost is recorded and the item goes back into use", async () => {
    const inProgress = await t.call("PATCH", `/api/repairs/${repairId}/status`, { status: "In Progress" }, k.tech);
    assert.equal(inProgress.status, 200);
    assert.ok(inProgress.data.repair.started_at);
    assert.equal(inProgress.data.repair.hours_taken, null);

    const done = await t.call("PATCH", `/api/repairs/${repairId}/status`, { status: "Completed", repair_cost: 35.5, resolution_note: "Replaced the capacitor" }, k.tech);
    assert.equal(done.status, 200);
    assert.ok(done.data.repair.completed_at);
    assert.equal(done.data.repair.repair_cost, 35.5);
    assert.equal(typeof done.data.repair.hours_taken, "number");
    assert.ok(done.data.repair.hours_taken >= 0);

    const item = (await t.call("GET", `/api/items/${done.data.repair.property_id}`, undefined, k.warden)).data;
    assert.equal(item.item.item_condition, "Good");
    assert.equal(item.item.status, "In use");
    assert.equal(Number(item.item.repair_cost_total), 35.5);
    const events = item.history.map((h) => h.event_type);
    assert.ok(events.includes("Repaired") && events.includes("Back in use"));
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.ann)).data.some((n) => n.title === "Repair completed"));

    assert.equal((await t.call("PATCH", `/api/repairs/${repairId}/status`, { status: "In Progress" }, k.warden)).status, 409);   // completed is locked
  });

  test("the original staff form still works: urgent requests alert the administrator", async () => {
    const r = await t.call("POST", "/api/repairs", { room_block: "A", room_floor: 1, room_number: 2, item_name: "Sink", description: "Water leak", priority: "Urgent" }, k.warden);
    assert.equal(r.status, 201);
    assert.match(r.data.repair.request_number, /^REP-/);
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.admin)).data.some((n) => n.title === "URGENT repair request"));
    assert.equal((await t.call("POST", "/api/repairs", { room_block: "A", room_floor: 9, room_number: 9, item_name: "Sink", description: "x" }, k.warden)).status, 404);
    assert.equal((await t.call("POST", "/api/repairs", { room_block: "A" }, k.warden)).status, 400);
    const status = await t.call("PATCH", `/api/repairs/${r.data.repair.repair_id}/status`, { status: "Assigned" }, k.warden);
    assert.equal(status.status, 200);
    assert.equal((await t.call("PATCH", "/api/repairs/abc/status", { status: "Assigned" }, k.warden)).status, 400);
  });
});

describe("maintenance jobs (the page added earlier)", () => {
  let jobId;
  const job = (extra = {}) => ({ room_block: "A", room_floor: 1, room_number: 2, maintenance_type: "Plumbing", description: "Check pipes", reported_date: "2026-10-20", expected_completion_date: "2026-11-30", ...extra });

  test("wardens and administrators add jobs and can pick a technician", async () => {
    assert.equal((await t.call("POST", "/api/maintenance", job({ maintenance_type: "Magic" }), k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/maintenance", job({ expected_completion_date: "2026-10-01" }), k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/maintenance", job({ assigned_user_id: 1 }), k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/maintenance", job(), k.tech)).status, 403);

    const c = await t.call("POST", "/api/maintenance", job({ assigned_user_id: await staffId("Tom Tech") }), k.warden);
    assert.equal(c.status, 201);
    jobId = c.data.maintenance.maintenance_id;
    assert.equal(c.data.maintenance.assigned_staff, "Tom Tech");
    assert.equal(c.data.maintenance.reported_date, "2026-10-20");
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.tech)).data.some((n) => n.title === "New maintenance job"));
  });

  test("a technician sees only their jobs and can complete only those", async () => {
    assert.equal((await t.call("GET", "/api/maintenance", undefined, k.tech)).data.length, 1);
    assert.equal((await t.call("GET", "/api/maintenance", undefined, k.tech2)).data.length, 0);
    assert.equal((await t.call("GET", "/api/maintenance", undefined, k.ann)).status, 403);
    assert.equal((await t.call("GET", "/api/maintenance", undefined, k.guard)).status, 403);
    assert.ok((await t.call("GET", "/api/maintenance", undefined, k.boss)).data.length >= 1);

    assert.equal((await t.call("PATCH", `/api/maintenance/${jobId}/complete`, {}, k.tech2)).status, 403);
    assert.equal((await t.call("PATCH", `/api/maintenance/${jobId}/complete`, {}, k.tech)).status, 200);
    assert.equal((await t.call("PATCH", `/api/maintenance/${jobId}/complete`, {}, k.tech)).status, 409);
    assert.equal((await t.call("PUT", `/api/maintenance/${jobId}`, { maintenance_type: "Plumbing", description: "x", status: "Pending" }, k.warden)).status, 409);
    assert.equal((await t.call("PUT", "/api/maintenance/9999", { maintenance_type: "Plumbing", description: "x" }, k.warden)).status, 404);
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.warden)).data.some((n) => n.title === "Maintenance completed"));
  });
});

describe("room applications and the waiting list", () => {
  const signup = async (number, name) => (await t.call("POST", "/api/auth/register", { student_number: number, full_name: name, email: `${number}@uni.edu`, password: "Strong123" })).data.token;
  const apply = (token, extra = {}) => t.call("POST", "/api/applications", { preferred_block: "B", faculty: "Arts", ...extra }, token);
  let zed; let yan; let xia; let wes;
  let appIds = {};

  test("a student who already has a room cannot apply; others can, once", async () => {
    assert.equal((await apply(k.ann)).status, 409);
    zed = await signup("20270001", "Zed Applicant");
    const a = await apply(zed);
    assert.equal(a.status, 201);
    appIds.zed = a.data.application.application_id;
    assert.equal(a.data.application.status, "Pending");
    assert.equal((await apply(zed)).status, 409);
    assert.ok((await t.call("GET", "/api/notifications", undefined, k.admin)).data.some((n) => n.title === "Room application waiting"));
  });

  test("only the administrator decides; the student cannot approve themselves", async () => {
    assert.equal((await t.call("POST", `/api/applications/${appIds.zed}/approve`, {}, zed)).status, 403);
    assert.equal((await t.call("POST", `/api/applications/${appIds.zed}/approve`, {}, k.warden)).status, 403);
    assert.equal((await t.call("GET", "/api/applications", undefined, k.warden)).status, 200);
    assert.equal((await t.call("GET", "/api/applications", undefined, k.ann)).data.length, 0);
  });

  test("approval gives the preferred room automatically, creates the student record and invoices", async () => {
    const ok = await t.call("POST", `/api/applications/${appIds.zed}/approve`, {}, k.admin);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.status, "Approved");
    assert.equal(ok.data.room_id, "B-01-01");
    assert.equal((await t.call("POST", `/api/applications/${appIds.zed}/approve`, {}, k.admin)).status, 409);

    const s = (await t.call("GET", "/api/students/20270001", undefined, k.warden)).data.student;
    assert.equal(s.room_block, "B");
    assert.equal(s.faculty, "Arts");
    assert.equal((await t.call("GET", "/api/fees", undefined, zed)).data.length, 2);
    assert.ok((await t.call("GET", "/api/notifications", undefined, zed)).data.some((n) => n.title === "Room application approved"));
    assert.equal((await t.call("GET", "/api/dashboard", undefined, zed)).data.resident, true);
  });

  test("when every room is full, applicants wait in order, then get rooms as they free up", async () => {
    yan = await signup("20270002", "Yan"); // takes the other bed in B-01-01
    appIds.yan = (await apply(yan)).data.application.application_id;
    assert.equal((await t.call("POST", `/api/applications/${appIds.yan}/approve`, {}, k.admin)).data.room_id, "B-01-01");

    const lastRoom = await signup("20270003", "Last Room"); // A-01-02 (single)
    const lr = (await apply(lastRoom, { preferred_block: "A" })).data.application.application_id;
    assert.equal((await t.call("POST", `/api/applications/${lr}/approve`, {}, k.admin)).data.room_id, "A-01-02");

    xia = await signup("20270004", "Xia");
    appIds.xia = (await apply(xia)).data.application.application_id;
    const w1 = await t.call("POST", `/api/applications/${appIds.xia}/approve`, {}, k.admin);
    assert.equal(w1.data.status, "Waitlisted");
    assert.equal(w1.data.waitlist_position, 1);

    wes = await signup("20270005", "Wes");
    appIds.wes = (await apply(wes)).data.application.application_id;
    assert.equal((await t.call("POST", `/api/applications/${appIds.wes}/waitlist`, {}, k.admin)).status, 200);
    const list = (await t.call("GET", "/api/applications", undefined, k.admin)).data;
    assert.deepEqual(list.filter((a) => a.status === "Waitlisted").map((a) => [a.full_name, a.waitlist_position]).sort(), [["Wes", 2], ["Xia", 1]]);
    assert.ok((await t.call("GET", "/api/notifications", undefined, xia)).data.some((n) => n.title === "You are on the waiting list"));
    assert.equal((await t.call("POST", "/api/applications/process-waitlist", {}, k.admin)).data.allocated, 0);

    const dash = (await t.call("GET", "/api/dashboard", undefined, k.admin)).data;
    assert.equal(dash.waiting.waitlisted, 2);
  });

  test("a check-out frees a bed and the first person waiting is allocated automatically", async () => {
    const out = await t.call("POST", "/api/students/20270002/checkout", { force: true }, k.warden);
    assert.equal(out.status, 200);
    assert.equal(out.data.waitlist_allocated, 1);

    const xiaApp = (await t.call("GET", "/api/applications", undefined, xia)).data[0];
    assert.equal(xiaApp.status, "Approved");
    assert.equal(xiaApp.assigned_room, "B-01-01");
    assert.ok((await t.call("GET", "/api/notifications", undefined, xia)).data.some((n) => n.title === "A room is ready for you"));

    const wesApp = (await t.call("GET", "/api/applications", undefined, wes)).data[0];
    assert.equal(wesApp.status, "Waitlisted");
    assert.equal(wesApp.waitlist_position, 1);               // renumbered
  });

  test("applications can be cancelled by the student or rejected with a reason", async () => {
    assert.equal((await t.call("POST", `/api/applications/${appIds.wes}/reject`, {}, k.admin)).status, 400);
    assert.equal((await t.call("POST", `/api/applications/${appIds.wes}/cancel`, {}, yan)).status, 403);
    assert.equal((await t.call("POST", `/api/applications/${appIds.wes}/cancel`, {}, wes)).status, 200);
    assert.equal((await t.call("POST", `/api/applications/${appIds.wes}/cancel`, {}, wes)).status, 409);
    const again = await apply(wes);
    assert.equal(again.status, 201);
    assert.equal((await t.call("POST", `/api/applications/${again.data.application.application_id}/reject`, { note: "Not enrolled this semester" }, k.admin)).status, 200);
    assert.ok((await t.call("GET", "/api/notifications", undefined, wes)).data.some((n) => n.title === "Room application declined"));
  });
});
