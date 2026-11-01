const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { boot, campus } = require("./helpers");

let t;
let k;

before(async () => { t = await boot(); k = await campus(t); });
after(async () => { await t.close(); });

describe("sign-in and permissions", () => {
  test("wrong password is refused, right one works", async () => {
    assert.equal((await t.call("POST", "/api/auth/login", { username: "admin", password: "nope" })).status, 401);
    const ok = await t.call("POST", "/api/auth/login", { username: "admin", password: "Admin@12345" });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.token);
    assert.equal(ok.data.user.role, "administrator");
  });

  test("login also works with email or student number", async () => {
    assert.equal((await t.call("POST", "/api/auth/login", { username: "20260001", password: "Passw0rd!" })).status, 200);
    assert.equal((await t.call("POST", "/api/auth/login", { username: "warden1@test.edu", password: "Passw0rd!" })).status, 200);
  });

  test("API needs a token; a forged token is refused", async () => {
    assert.equal((await t.call("GET", "/api/rooms")).status, 401);
    assert.equal((await t.call("GET", "/api/rooms", undefined, "abc.def")).status, 401);
    const forged = Buffer.from(JSON.stringify({ uid: 1, role: "administrator", exp: 9999999999 })).toString("base64url") + ".AAAA";
    assert.equal((await t.call("GET", "/api/rooms", undefined, forged)).status, 401);
  });

  test("each role only reaches its own areas", async () => {
    assert.equal((await t.call("GET", "/api/rooms", undefined, k.ann)).status, 403);          // student
    assert.equal((await t.call("GET", "/api/students", undefined, k.tech)).status, 403);      // maintenance
    assert.equal((await t.call("GET", "/api/users", undefined, k.warden)).status, 403);       // warden
    assert.equal((await t.call("POST", "/api/fees", {}, k.boss)).status, 403);                // management is view-only
    assert.equal((await t.call("POST", "/api/damages", {}, k.guard)).status, 403);           // security
    assert.equal((await t.call("GET", "/api/audit", undefined, k.warden)).status, 403);
    assert.equal((await t.call("GET", "/api/rooms", undefined, k.boss)).status, 200);        // management can look
  });

  test("a temporary password must be changed before anything else", async () => {
    const created = await t.call("POST", "/api/users", { username: "newwarden", full_name: "New Warden", role: "warden", password: "Temp12345" }, k.admin);
    assert.equal(created.status, 201);
    const token = await t.login("newwarden", "Temp12345");
    const blocked = await t.call("GET", "/api/rooms", undefined, token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.mustChangePassword, true);
    assert.equal((await t.call("POST", "/api/auth/change-password", { current_password: "Temp12345", new_password: "short" }, token)).status, 400);
    assert.equal((await t.call("POST", "/api/auth/change-password", { current_password: "Temp12345", new_password: "Better2026x" }, token)).status, 200);
    assert.equal((await t.call("GET", "/api/rooms", undefined, token)).status, 200);
  });

  test("students sign up themselves; records already in the system must match the email", async () => {
    const weak = await t.call("POST", "/api/auth/register", { student_number: "20269999", full_name: "Zed", email: "z@uni.edu", password: "abc" });
    assert.equal(weak.status, 400);
    const ok = await t.call("POST", "/api/auth/register", { student_number: "20269999", full_name: "Zed Applicant", email: "z@uni.edu", password: "Strong123" });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.user.role, "student");
    const dup = await t.call("POST", "/api/auth/register", { student_number: "20269999", full_name: "Zed", email: "z@uni.edu", password: "Strong123" });
    assert.equal(dup.status, 409);
    // 20260002 is a known resident: wrong email is refused
    const wrong = await t.call("POST", "/api/auth/register", { student_number: "20260002", full_name: "Imposter", email: "other@uni.edu", password: "Strong123" });
    assert.ok([400, 409].includes(wrong.status));
  });

  test("an administrator can disable an account and cannot remove the last administrator", async () => {
    const users = (await t.call("GET", "/api/users", undefined, k.admin)).data;
    const guard = users.find((u) => u.username === "guard1");
    assert.equal((await t.call("PUT", `/api/users/${guard.user_id}`, { full_name: guard.full_name, role: "security", status: "Disabled" }, k.admin)).status, 200);
    assert.equal((await t.call("GET", "/api/incidents", undefined, k.guard)).status, 401);
    const admin = users.find((u) => u.username === "admin");
    const demote = await t.call("PUT", `/api/users/${admin.user_id}`, { full_name: "x", role: "warden", status: "Active" }, k.admin);
    assert.equal(demote.status, 400);
    await t.call("PUT", `/api/users/${guard.user_id}`, { full_name: guard.full_name, role: "security", status: "Active" }, k.admin);
  });

  test("security headers are set", async () => {
    const r = await t.call("GET", "/api/health");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  });
});

describe("rooms, beds and item list", () => {
  test("rooms were created with beds and the standard item list", async () => {
    const rooms = (await t.call("GET", "/api/rooms", undefined, k.warden)).data;
    const a1 = rooms.find((r) => r.room_id === "A-01-01");
    assert.equal(a1.capacity, 2);
    assert.equal(a1.occupied, 2);
    assert.equal(a1.room_type, "Double");

    const detail = (await t.call("GET", "/api/rooms/A-01-01/detail", undefined, k.warden)).data;
    assert.equal(detail.items.length, 19);                      // 5 per-bed types x 2 beds + 9 fixed
    assert.equal(detail.beds.length, 2);
    assert.equal(detail.beds.filter((b) => b.student_number).length, 2);
    assert.equal(detail.residents.length, 2);
    assert.match(detail.items.find((i) => i.item_name === "Chair").item_code, /^CH-A101-0[12]$/);
  });

  test("standard items are never duplicated", async () => {
    const again = await t.call("POST", "/api/rooms/A-01-01/standard-items", {}, k.admin);
    assert.equal(again.data.created, 0);
  });

  test("duplicate room and bad capacity are refused; capacity cannot go below the residents", async () => {
    assert.equal((await t.call("POST", "/api/rooms", { block: "A", floor: 1, room_number: 1, capacity: 2 }, k.admin)).status, 409);
    assert.equal((await t.call("POST", "/api/rooms", { block: "C", floor: 1, room_number: 1, capacity: 50 }, k.admin)).status, 400);
    assert.equal((await t.call("PUT", "/api/rooms/A-01-01", { capacity: 1 }, k.admin)).status, 400);
    assert.equal((await t.call("PUT", "/api/rooms/A-01-01", { capacity: 3, room_type: "Triple" }, k.admin)).status, 200);
    assert.equal((await t.call("PUT", "/api/rooms/A-01-01", { capacity: 2, room_type: "Double" }, k.admin)).status, 200);
  });

  test("item history starts with 'New' and items can be added, edited and replaced", async () => {
    const items = (await t.call("GET", "/api/items?room_id=A-01-02", undefined, k.warden)).data;
    assert.ok(items.length > 0);
    const one = await t.call("GET", `/api/items/${items[0].property_id}`, undefined, k.warden);
    assert.equal(one.data.history[0].event_type, "New");

    const types = (await t.call("GET", "/api/items/types", undefined, k.warden)).data;
    const add = await t.call("POST", "/api/items", { type_id: types[0].type_id, room_id: "A-01-02" }, k.warden);
    assert.equal(add.status, 201);

    assert.equal((await t.call("PUT", `/api/items/${add.data.property_id}`, { item_condition: "Broken", status: "Under repair" }, k.admin)).status, 200);
    const replaced = await t.call("POST", `/api/items/${add.data.property_id}/replace`, {}, k.admin);
    assert.equal(replaced.status, 200);
    const hist = (await t.call("GET", `/api/items/${add.data.property_id}`, undefined, k.admin)).data.history.map((h) => h.event_type);
    assert.deepEqual(hist.slice(0, 1), ["New"]);
    assert.ok(hist.includes("Replaced"));
    assert.equal((await t.call("POST", `/api/items/${add.data.property_id}/replace`, {}, k.admin)).status, 409);
  });
});

describe("students and allocation", () => {
  test("registering a student fills a bed, creates fees and a cleaning job, and tells the student", async () => {
    const fees = (await t.call("GET", "/api/fees", undefined, k.ann)).data;
    assert.deepEqual(fees.map((f) => f.fee_type).sort(), ["Hostel fee", "Security deposit"]);
    const jobs = (await t.call("GET", "/api/maintenance", undefined, k.warden)).data;
    assert.ok(jobs.some((j) => j.maintenance_type === "Cleaning" && j.description.includes("new student")));
    const n = (await t.call("GET", "/api/notifications", undefined, k.ann)).data;
    assert.ok(n.some((x) => x.title === "Room allocated"));
  });

  test("full, missing and duplicate registrations are refused (original rules)", async () => {
    const body = { student_number: "20260003", full_name: "Cy", email: "cy@uni.edu", room_block: "A", room_floor: 1, room_number: 1 };
    assert.equal((await t.call("POST", "/api/students", body, k.warden)).status, 400);                           // room full
    assert.equal((await t.call("POST", "/api/students", { ...body, room_number: 99 }, k.warden)).status, 404);   // no such room
    assert.equal((await t.call("POST", "/api/students", { student_number: "x" }, k.warden)).status, 400);        // missing fields
    assert.equal((await t.call("POST", "/api/students", { ...body, student_number: "20260001", room_number: 2 }, k.warden)).status, 409); // duplicate
  });

  test("staff can see, search and edit a student; the student sees their own profile", async () => {
    const list = (await t.call("GET", "/api/students", undefined, k.warden)).data;
    assert.equal(list.length, 2);
    assert.equal(list[0].student_status, "Active");
    const lookup = (await t.call("GET", "/api/students/lookup?q=Ann", undefined, k.guard)).data;
    assert.equal(lookup[0].student_number, "20260001");
    assert.equal((await t.call("PUT", "/api/students/20260001", { full_name: "Ann Student", email: "20260001@uni.edu", phone: "013-999", faculty: "Law", emergency_contact_name: "Mum", emergency_contact_phone: "012-000" }, k.warden)).status, 200);
    const me = (await t.call("GET", "/api/profile", undefined, k.ann)).data;
    assert.equal(me.student.faculty, "Law");
    assert.equal(me.student.room_id, "A-01-01");
    assert.equal((await t.call("PUT", "/api/profile", { full_name: "Ann Student", email: "ann@uni.edu", phone: "014-555", faculty: "Law" }, k.ann)).status, 200);
    assert.equal((await t.call("GET", "/api/profile", undefined, k.ann)).data.student.phone, "014-555");
  });

  test("students can add documents; a PDF is allowed for documents only", async () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF").toString("base64");
    const asPhoto = await t.call("POST", "/api/files", { data: pdf, purpose: "photo" }, k.ann);
    assert.equal(asPhoto.status, 400);
    const asDoc = await t.call("POST", "/api/files", { data: pdf, purpose: "document", name: "offer.pdf" }, k.ann);
    assert.equal(asDoc.status, 201);
    assert.equal((await t.call("POST", "/api/profile/documents", { doc_type: "Offer letter", file_id: asDoc.data.id }, k.ann)).status, 201);
    const docs = (await t.call("GET", "/api/students/20260001", undefined, k.warden)).data.documents;
    assert.equal(docs.length, 1);
  });
});

describe("photos are private and checked", () => {
  test("only real photos are accepted; links are signed", async () => {
    assert.equal((await t.call("POST", "/api/files", { data: Buffer.from("hello world").toString("base64"), purpose: "photo" }, k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/files", { data: "" }, k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/files", { data: "AAAA" })).status, 401);

    const id = await t.photo(k.warden);
    const up = await t.call("POST", "/api/files", { data: `data:image/png;base64,${t.PNG}`, name: "x.png" }, k.warden);
    const good = await t.call("GET", up.data.url);
    assert.equal(good.status, 200);
    assert.equal(good.headers.get("content-type"), "image/png");
    assert.equal((await t.call("GET", up.data.url.replace(/sig=.{4}/, "sig=AAAA"))).status, 403);
    assert.equal((await t.call("GET", `/api/files/${id}`)).status, 403);
  });
});

describe("inspections with photos, confirmation and comparison", () => {
  let checkin;

  test("the checklist comes from the room's item list", async () => {
    const r = (await t.call("GET", "/api/inspections/room-items?room_id=A-01-01", undefined, k.warden)).data;
    assert.equal(r.from_inventory, true);
    assert.equal(r.items.length, 19);
    assert.equal(r.residents.length, 2);
  });

  test("a check-in needs photos; damaged items need photo proof", async () => {
    const list = (await t.call("GET", "/api/inspections/room-items?room_id=A-01-01", undefined, k.warden)).data.items;
    const mk = (extra = {}) => ({ room_id: "A-01-01", student_number: "20260001", inspection_type: "Check-in", inspection_items: list.map((i) => ({ property_id: i.property_id, item: i.item, condition: "Good", note: "" })), ...extra });

    assert.equal((await t.call("POST", "/api/inspections", mk(), k.warden)).status, 400);            // no photo at all
    const withBad = mk(); withBad.inspection_items[0].condition = "Damaged";
    assert.equal((await t.call("POST", "/api/inspections", withBad, k.warden)).status, 400);         // damaged, no photo
    assert.equal((await t.call("POST", "/api/inspections", { ...mk(), inspection_items: [] }, k.warden)).status, 400);
    assert.equal((await t.call("POST", "/api/inspections", mk({ student_number: "20260999" }), k.warden)).status, 400); // not their room
    assert.equal((await t.call("POST", "/api/inspections", mk(), k.tech)).status, 403);

    const p = await t.photo(k.warden);
    const full = mk();
    full.inspection_items[0].photo_ids = [p];
    const bad = await t.call("POST", "/api/inspections", { ...full, inspection_items: full.inspection_items.map((i, n) => (n === 1 ? { ...i, photo_ids: ["nope"] } : i)) }, k.warden);
    assert.equal(bad.status, 400);                                                                    // unknown photo id

    const ok = await t.call("POST", "/api/inspections", full, k.warden);
    assert.equal(ok.status, 201);
    checkin = ok.data.inspection;
    assert.equal(checkin.confirmation_status, "Pending");
    assert.equal(checkin.items.length, 19);
    assert.equal(checkin.items[0].photos.length, 1);
    assert.match(checkin.items[0].photos[0].url, /^\/api\/files\//);
  });

  test("the student is asked to confirm, and can confirm only their own check-in, once", async () => {
    const n = (await t.call("GET", "/api/notifications", undefined, k.ann)).data;
    assert.ok(n.some((x) => x.title === "Please confirm your room condition"));
    assert.equal((await t.call("POST", `/api/inspections/${checkin.inspection_id}/confirm`, { action: "confirm" }, k.ben)).status, 403);
    assert.equal((await t.call("GET", `/api/inspections/${checkin.inspection_id}`, undefined, k.ben)).status, 403);
    assert.equal((await t.call("POST", `/api/inspections/${checkin.inspection_id}/confirm`, { action: "confirm" }, k.ann)).status, 200);
    assert.equal((await t.call("POST", `/api/inspections/${checkin.inspection_id}/confirm`, { action: "confirm" }, k.ann)).status, 409);
    assert.equal((await t.call("GET", `/api/inspections/${checkin.inspection_id}`, undefined, k.ann)).data.confirmation_status, "Confirmed");
    const mine = (await t.call("GET", "/api/inspections", undefined, k.ann)).data;
    assert.equal(mine.length, 1);
  });

  test("a student can dispute a check-in only with a reason", async () => {
    const list = (await t.call("GET", "/api/inspections/room-items?room_id=A-01-01", undefined, k.warden)).data.items;
    const p = await t.photo(k.warden);
    const r = await t.call("POST", "/api/inspections", { room_id: "A-01-01", student_number: "20260002", inspection_type: "Check-in", inspection_items: [{ property_id: list[0].property_id, item: list[0].item, condition: "Good", photo_ids: [p] }] }, k.warden);
    assert.equal(r.status, 201);
    const id = r.data.inspection.inspection_id;
    assert.equal((await t.call("POST", `/api/inspections/${id}/confirm`, { action: "dispute" }, k.ben)).status, 400);
    assert.equal((await t.call("POST", `/api/inspections/${id}/confirm`, { action: "dispute", comment: "The desk was already scratched" }, k.ben)).status, 200);
    assert.equal((await t.call("GET", `/api/inspections/${id}`, undefined, k.ben)).data.confirmation_status, "Disputed");
  });

  test("a check-out is compared with the check-in and shows new damage", async () => {
    const mattress = checkin.items.find((i) => i.item === "Mattress");
    const items = checkin.items.map((i) => ({ property_id: i.property_id, item: i.item, condition: "Good", note: "" }));
    const m = items.findIndex((i) => i.item === "Mattress");
    items[m] = { ...items[m], condition: "Broken", note: "Large tear", photo_ids: [await t.photo(k.warden)] };

    const out = await t.call("POST", "/api/inspections", { room_id: "A-01-01", student_number: "20260001", inspection_type: "Check-out", inspection_items: items }, k.warden);
    assert.equal(out.status, 201);
    assert.equal(out.data.comparison.new_damage, 1);
    assert.equal(out.data.comparison.baseline_id, checkin.inspection_id);

    const row = out.data.comparison.rows.find((r) => r.item === "Mattress");
    assert.equal(row.checkin_condition, "Good");
    assert.equal(row.checkout_condition, "Broken");
    assert.equal(row.result, "New damage");
    assert.equal(out.data.comparison.rows.filter((r) => r.result === "No change").length, 18);

    const again = await t.call("GET", `/api/inspections/${out.data.inspection.inspection_id}/compare`, undefined, k.ann);
    assert.equal(again.status, 200);
    assert.equal((await t.call("GET", `/api/inspections/${checkin.inspection_id}/compare`, undefined, k.warden)).status, 400);  // only for check-outs
    assert.equal((await t.call("GET", `/api/inspections/${out.data.inspection.inspection_id}/compare`, undefined, k.ben)).status, 403);

    const admin = (await t.call("GET", "/api/notifications", undefined, k.admin)).data;
    assert.ok(admin.some((x) => x.title === "New damage found at check-out"));
    assert.ok(mattress.property_id);
  });
});
