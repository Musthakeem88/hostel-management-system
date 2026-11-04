/* =========================================================
   Demo data: a small campus with residents, inspections, damage, fines, repairs, fees...
   Built through the real API so every business rule is followed.

     npm run seed:demo            (uses the database in .env)
     DB_DRIVER=sqlite SQLITE_FILE=demo.sqlite npm run seed:demo     (no PostgreSQL needed)

   All demo accounts use the password  Demo@1234
   accounts: admin (your own), warden, tech1, tech2, guard, manager, and students 20260001 ... 20260007
========================================================= */
const zlib = require("zlib");
const crypto = require("crypto");
const pool = require("../db");
const { createApp } = require("../server");
const { hashPassword } = require("../lib/auth");
const { runDailyChecks, runMonthlyReport, previousMonth } = require("../lib/scheduler");
const { today, addDays } = require("../lib/validate");

const PASSWORD = "Demo@1234";

/* ---------- tiny PNG maker so the demo photos look like something ---------- */
function crc(buf) {
  let c, crcv = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crcv ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcv = (crcv >>> 8) ^ c;
  }
  return (crcv ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x += 1) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
let photoNo = 0;
function demoPhoto(kind) {
  photoNo += 1;
  const hue = { good: [70, 140, 120], damage: [150, 70, 60], room: [90, 110, 150], item: [140, 120, 80] }[kind] || [100, 100, 100];
  return png(240, 180, (x, y) => {
    const wall = y < 110;
    const base = wall ? hue : [Math.floor(hue[0] * 0.55), Math.floor(hue[1] * 0.55), Math.floor(hue[2] * 0.55)];
    const stripe = ((x + y + photoNo * 17) % 38) < 3 ? 22 : 0;
    const box = x > 70 + photoNo * 3 % 40 && x < 170 && y > 60 && y < 140;
    const tear = kind === "damage" && Math.abs((x - 110) - (y - 100) * 0.6) < 2 && y > 70 && y < 130;
    return tear ? [30, 20, 20] : box ? [Math.min(255, base[0] + 55 + stripe), Math.min(255, base[1] + 45 + stripe), Math.min(255, base[2] + 35 + stripe)] : [base[0] + stripe, base[1] + stripe, base[2] + stripe];
  });
}

async function main() {
  const app = await createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, token, quiet = false) {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : {};
    if (!res.ok && !quiet) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  }

  // a temporary administrator for the seeding itself (removed at the end)
  const tmp = `seed_${crypto.randomBytes(3).toString("hex")}`;
  const tmpPassword = crypto.randomBytes(9).toString("base64url") + "1a";
  await pool.query(`INSERT INTO users (username, full_name, role, password_hash, status, must_change_password, created_at) VALUES ($1, 'Demo seeding', 'administrator', $2, 'Active', 0, CURRENT_TIMESTAMP)`, [tmp, hashPassword(tmpPassword)]);
  const login = async (username, password) => (await call("POST", "/api/auth/login", { username, password })).token;
  const admin = await login(tmp, tmpPassword);

  if ((await call("GET", "/api/rooms", undefined, admin)).length > 0) {
    console.log("There are already rooms in this database, so no demo data was added.");
    await pool.query("DELETE FROM users WHERE username = $1", [tmp]);
    server.close(); return;
  }

  const photo = async (token, kind) => (await call("POST", "/api/files", { data: `data:image/png;base64,${demoPhoto(kind).toString("base64")}`, name: `${kind}.png`, purpose: "photo" }, token)).id;

  /* ----- rooms and staff ----- */
  const rooms = [["A", 1, 1, 2, "Double"], ["A", 1, 2, 2, "Double"], ["A", 1, 3, 2, "Double"], ["A", 2, 1, 3, "Triple"], ["B", 1, 1, 2, "Double"], ["B", 1, 2, 1, "Single"], ["B", 1, 3, 2, "Double"], ["C", 1, 1, 4, "Quad"]];
  for (const [block, floor, number, capacity, type] of rooms) await call("POST", "/api/rooms", { block, floor, room_number: number, capacity, room_type: type, standard_items: true }, admin);
  await call("PUT", "/api/rooms/A-02-01", { capacity: 3, room_type: "Triple", under_maintenance: true }, admin);

  const mkUser = async (username, name, role, extra = {}) => {
    await pool.query(`INSERT INTO users (username, full_name, email, role, password_hash, status, student_number, must_change_password, created_at) VALUES ($1, $2, $3, $4, $5, 'Active', $6, 0, CURRENT_TIMESTAMP)`, [username, name, `${username}@hostel.test`, role, hashPassword(PASSWORD), extra.student || null]);
    return login(username, PASSWORD);
  };
  const warden = await mkUser("warden", "Wendy Warden", "warden");
  const tech1 = await mkUser("tech1", "Tom Technician", "maintenance");
  const tech2 = await mkUser("tech2", "Tina Technician", "maintenance");
  const guard = await mkUser("guard", "Gary Guard", "security");
  const manager = await mkUser("manager", "Mia Manager", "management");
  const staff = (await call("GET", "/api/users/directory?role=maintenance", undefined, warden));
  const techId = (name) => staff.find((s) => s.full_name === name).user_id;

  /* ----- residents ----- */
  const people = [
    ["20260001", "Aisyah Rahman", "A", 1, 1, "Engineering"], ["20260002", "Daniel Lim", "A", 1, 1, "Engineering"],
    ["20260003", "Siti Nurhaliza", "A", 1, 2, "Medicine"], ["20260004", "Kumar Raj", "A", 1, 2, "Business"],
    ["20260005", "Mei Ling Tan", "B", 1, 1, "Arts"], ["20260006", "Farid Hassan", "B", 1, 1, "Science"], ["20260007", "Nurul Izzah", "B", 1, 2, "Law"]
  ];
  const tokens = {};
  for (const [number, name, block, floor, room, faculty] of people) {
    tokens[number] = await mkUser(number, name, "student", { student: number });
    await call("POST", "/api/students", { student_number: number, full_name: name, email: `${number}@uni.edu.my`, phone: "012-34" + number.slice(-5), faculty, emergency_contact_name: "Parent of " + name.split(" ")[0], emergency_contact_phone: "019-8887766", room_block: block, room_floor: floor, room_number: room }, warden);
  }

  /* ----- check-in inspections with photos ----- */
  const checkin = async (number, roomId, { bad } = {}) => {
    const list = (await call("GET", `/api/inspections/room-items?room_id=${roomId}`, undefined, warden)).items;
    const items = [{ item: "Room overview", condition: "Good", photo_ids: [await photo(warden, "room"), await photo(warden, "room")] }];
    for (const i of list) {
      const isBad = bad && i.item === bad.item;
      items.push({ property_id: i.property_id, item: i.item, condition: isBad ? bad.condition : "Good", note: isBad ? bad.note : "", photo_ids: isBad ? [await photo(warden, "damage")] : [] });
    }
    return (await call("POST", "/api/inspections", { room_id: roomId, student_number: number, inspection_type: "Check-in", inspection_items: items, general_notes: "Walked through with the student." }, warden)).inspection;
  };
  const ins = {};
  for (const [number, , block, floor, room] of people) {
    const id = `${block}-${String(floor).padStart(2, "0")}-${String(room).padStart(2, "0")}`;
    ins[number] = await checkin(number, id, number === "20260005" ? { bad: { item: "Desk", condition: "Damaged", note: "Scratch on the desk top" } } : {});
  }
  await call("POST", `/api/inspections/${ins["20260001"].inspection_id}/confirm`, { action: "confirm" }, tokens["20260001"]);
  await call("POST", `/api/inspections/${ins["20260002"].inspection_id}/confirm`, { action: "confirm" }, tokens["20260002"]);
  await call("POST", `/api/inspections/${ins["20260004"].inspection_id}/confirm`, { action: "confirm" }, tokens["20260004"]);
  await call("POST", `/api/inspections/${ins["20260005"].inspection_id}/confirm`, { action: "dispute", comment: "The desk scratch was already there and is bigger than shown." }, tokens["20260005"]);
  await call("POST", `/api/inspections/${ins["20260007"].inspection_id}/confirm`, { action: "confirm" }, tokens["20260007"]);

  /* ----- fees and payments ----- */
  const fees = async (n) => (await call("GET", `/api/fees?student_number=${n}`, undefined, admin));
  const pay = async (fee, amount, method = "Bank transfer") => call("POST", "/api/payments", { fee_id: fee.fee_id, amount, method, reference: "DEMO" }, admin);
  for (const n of ["20260001", "20260002", "20260003", "20260005", "20260007"]) { const f = await fees(n); await pay(f.find((x) => x.fee_type === "Security deposit"), 300); }
  for (const n of ["20260002", "20260003"]) { const f = await fees(n); await pay(f.find((x) => x.fee_type === "Hostel fee"), 1200, "Card"); }
  await pay((await fees("20260001")).find((x) => x.fee_type === "Hostel fee"), 600);
  await call("POST", "/api/fees", { scope: "student", student_number: "20260004", fee_type: "Other", amount: 45, due_date: addDays(today(), -12), description: "Laundry card replacement" }, admin);

  /* ----- damage, fines, appeals ----- */
  const damage = async (number, roomId, item, type, desc, repair, replace) => (await call("POST", "/api/damages", {
    room_id: roomId, student_number: number, item_name: item, description: desc, damage_type: type, repair_cost: repair, replacement_cost: replace,
    evidence_photo_ids: [await photo(warden, "damage"), await photo(warden, "damage")] }, warden)).damage;
  const confirm = (id, type, extra = {}) => call("POST", `/api/damages/${id}/review`, { action: "confirm", damage_type: type, ...extra }, admin);

  const d1 = await damage("20260001", "A-01-01", "Mattress", "Accidental damage", "Large tear in the mattress cover near the corner", 80, 180);
  await confirm(d1.damage_id, "Accidental damage", { note: "Photos clearly show the tear." });
  const f1 = (await call("POST", "/api/fines", { damage_id: d1.damage_id, reason: "Mattress torn during the stay", note: "Policy 4.2" }, admin)).fine;
  await call("POST", `/api/fines/${f1.fine_id}/appeal`, { reason: "The mattress already had a worn corner when I arrived, the check-in photos show it." }, tokens["20260001"]);

  const d2 = await damage("20260003", "A-01-02", "Chair", "Confirmed vandalism", "Chair leg broken off on purpose", 40, 90);
  await confirm(d2.damage_id, "Confirmed vandalism");
  const f2 = (await call("POST", "/api/fines", { damage_id: d2.damage_id, reason: "Chair deliberately broken" }, admin)).fine;
  await call("POST", "/api/payments", { fine_id: f2.fine_id, amount: f2.amount, method: "Cash", reference: "CNT-221" }, admin);

  await damage("20260005", "B-01-01", "Desk", "Accidental damage", "Deep scratch across the desk top", 35, 220);
  const d4 = await damage("20260004", "A-01-02", "Mirror", "Accidental damage", "Crack in the corner of the mirror", 25, 60);
  await call("POST", `/api/damages/${d4.damage_id}/review`, { action: "investigate", note: "Asking the roommate what happened." }, admin);
  const d5 = await damage("20260006", "B-01-01", "Window", "Normal wear", "Window handle loose from age", 15, 0);
  await confirm(d5.damage_id, "Normal wear", { create_repair: false });

  /* ----- a full check-out: comparison, new damage, fine, deposit ----- */
  const list7 = (await call("GET", "/api/inspections/room-items?room_id=B-01-02", undefined, warden)).items;
  const out7 = list7.map((i) => ({ property_id: i.property_id, item: i.item, condition: "Good", note: "" }));
  const m = out7.findIndex((i) => i.item === "Mattress");
  out7[m] = { ...out7[m], condition: "Broken", note: "Large tear and a burn mark", photo_ids: [await photo(warden, "damage")] };
  const co = (await call("POST", "/api/inspections", { room_id: "B-01-02", student_number: "20260007", inspection_type: "Check-out", inspection_items: out7 }, warden)).inspection;
  const d6 = await damage("20260007", "B-01-02", "Mattress", "Accidental damage", "Mattress torn and burnt (found at check-out)", 120, 180);
  await confirm(d6.damage_id, "Accidental damage");
  await call("POST", "/api/fines", { damage_id: d6.damage_id, reason: "Mattress torn and burnt" }, admin);
  await call("POST", "/api/students/20260007/checkout", {}, warden);

  /* ----- repairs and maintenance ----- */
  const repair = async (n, item, desc, priority, withPhoto = true) => (await call("POST", "/api/repairs", { item_name: item, description: desc, priority, photo_ids: withPhoto ? [await photo(tokens[n], "item")] : [] }, tokens[n])).repair;
  await repair("20260002", "Ceiling fan", "The fan wobbles and makes a loud noise at night", "Low");
  const r2 = await repair("20260003", "Sink", "Water leaks under the sink and the floor is wet", "Urgent");
  const r3 = await repair("20260004", "Tube light", "One tube light flickers", "Normal", false);
  const r4 = await repair("20260006", "Window", "The window does not close properly", "Normal");
  await call("POST", `/api/repairs/${r2.repair_id}/assign`, { user_id: techId("Tom Technician") }, warden);
  await call("PATCH", `/api/repairs/${r2.repair_id}/status`, { status: "In Progress" }, tech1);
  await call("POST", `/api/repairs/${r3.repair_id}/assign`, { user_id: techId("Tina Technician") }, warden);
  await call("PATCH", `/api/repairs/${r3.repair_id}/status`, { status: "In Progress" }, tech2);
  await call("PATCH", `/api/repairs/${r3.repair_id}/status`, { status: "Completed", repair_cost: 18.5, resolution_note: "Replaced the tube and the starter." }, tech2);
  await call("POST", `/api/repairs/${r4.repair_id}/assign`, { user_id: techId("Tina Technician") }, warden);

  const job = (room, type, desc, tech, reported, expected) => call("POST", "/api/maintenance", { room_id: room, room_block: room.split("-")[0], room_floor: Number(room.split("-")[1]), room_number: Number(room.split("-")[2]), maintenance_type: type, description: desc, assigned_user_id: tech || undefined, reported_date: reported, expected_completion_date: expected }, warden);
  await job("B-01-01", "Plumbing", "Check pipes under the bathroom sink", techId("Tom Technician"), addDays(today(), -9), addDays(today(), -3));
  await job("A-01-02", "Electrical", "Replace the socket near the desk", techId("Tina Technician"), addDays(today(), -2), addDays(today(), 5));
  await job("A-01-03", "Furniture", "Wardrobe door hinge is loose", null, addDays(today(), -1), null);
  const jobs = await call("GET", "/api/maintenance", undefined, warden);
  const clean = jobs.find((j) => j.maintenance_type === "Cleaning");
  if (clean) await call("PATCH", `/api/maintenance/${clean.maintenance_id}/complete`, {}, warden);

  /* ----- applications ----- */
  for (const [n, name] of [["20270001", "Zed Applicant"], ["20270002", "Yan Applicant"]]) {
    const t = (await call("POST", "/api/auth/register", { student_number: n, full_name: name, email: `${n}@uni.edu.my`, password: PASSWORD })).token;
    await call("POST", "/api/applications", { preferred_block: n === "20270001" ? "C" : "A", faculty: "Arts", notes: "Would like a quiet room." }, t);
  }

  /* ----- everyday life ----- */
  await call("POST", "/api/m/visitors", { visitor_name: "Mr Rahman (father)", relationship: "Parent", purpose: "Bring study materials", visit_date: today() }, tokens["20260001"]);
  const v2 = await call("POST", "/api/m/visitors", { student_number: "20260002", visitor_name: "Lim Wei (brother)", relationship: "Sibling", visit_date: today() }, guard);
  await call("POST", `/api/m/visitors/${v2.row.visitor_id}/approve`, {}, warden);
  await call("POST", `/api/m/visitors/${v2.row.visitor_id}/check_in`, {}, guard);
  await call("POST", "/api/m/visitors", { student_number: "20260005", visitor_name: "Tan Mei (sister)", relationship: "Sibling", visit_date: today() }, warden);

  await call("POST", "/api/m/leaves", { leave_type: "Home visit", destination: "Ipoh", reason: "Family gathering", leave_from: addDays(today(), 2), leave_to: addDays(today(), 4), return_time: "20:00" }, tokens["20260002"]);
  const l2 = await call("POST", "/api/m/leaves", { leave_type: "Weekend", destination: "Penang", reason: "Visiting relatives", leave_from: today(), leave_to: addDays(today(), 1) }, tokens["20260003"]);
  await call("POST", `/api/m/leaves/${l2.row.leave_id}/approve`, {}, warden);
  await call("POST", "/api/m/leaves", { student_number: "20260004", leave_type: "Late arrival", reason: "Arrived at 01:20 after the last bus", leave_from: today(), leave_to: today() }, guard);

  await call("POST", "/api/m/transfers", { preferred_block: "A", reason: "My roommate studies with loud music late at night." }, tokens["20260006"]);
  await call("POST", "/api/m/complaints", { category: "Complaint", subject: "No hot water on floor 1", message: "There has been no hot water in the Block A bathrooms for three days." }, tokens["20260001"]);
  const c2 = await call("POST", "/api/m/complaints", { category: "Suggestion", subject: "More study tables", message: "Could the common room have more study tables during exam weeks?" }, tokens["20260002"]);
  await call("POST", `/api/m/complaints/${c2.row.complaint_id}/respond`, { response: "Thank you! We will add six tables before the exam period." }, warden);

  await call("POST", "/api/m/notices", { title: "Planned water cut on Sunday", body: "Water will be off from 9am to 1pm for tank cleaning. Please store water in advance.", audience: "All", priority: "Important" }, warden);
  await call("POST", "/api/m/notices", { title: "Hostel fee payment reminder", body: "Semester hostel fees are due within 14 days of your invoice date. Pay at the hostel office or by bank transfer.", audience: "Students" }, admin);

  await call("POST", "/api/m/keys", { room: "A-01-01", key_number: "K-0101-A", student_number: "20260001" }, warden);
  await call("POST", "/api/m/keys", { room: "A-01-01", key_number: "K-0101-B", student_number: "20260002" }, warden);
  const k3 = await call("POST", "/api/m/keys", { room: "B-01-01", key_number: "K-0201-A", student_number: "20260005" }, guard);
  await call("POST", `/api/m/keys/${k3.row.key_id}/lost`, {}, guard);

  const i1 = await call("POST", "/api/m/incidents", { incident_type: "Fire", severity: "Critical", location: "Block A pantry", description: "Smoke from the microwave in the pantry. Fire alarm sounded." }, guard);
  await call("POST", `/api/m/incidents/${i1.row.incident_id}/resolve`, { action_taken: "Microwave unplugged, area ventilated, fire brigade confirmed no fire. Microwave removed." }, warden);
  await call("POST", "/api/m/incidents", { incident_type: "Safety hazard", severity: "Medium", location: "Block B stairs", description: "Loose handrail on the second-floor stairs." }, warden);

  await call("POST", "/api/m/lostfound", { kind: "Lost", item_name: "Blue water bottle", description: "Metal bottle with a dent", location: "Study room" }, tokens["20260002"]);
  await call("POST", "/api/m/lostfound", { kind: "Found", item_name: "Keys on a red lanyard", location: "Main gate" }, guard);

  for (const [block, utility, date, value, cost] of [["A", "Electricity", addDays(today(), -60), 41200, 0], ["A", "Electricity", addDays(today(), -30), 42650, 612.5], ["B", "Electricity", addDays(today(), -30), 18800, 0], ["A", "Water", addDays(today(), -30), 930, 0], ["A", "Water", today(), 985, 96]]) {
    await call("POST", "/api/m/utilities", { block, utility, reading_date: date, reading_value: value, cost }, admin);
  }

  /* ----- scheduled jobs ----- */
  await runDailyChecks();
  await runMonthlyReport(previousMonth(today()), { force: true });

  await pool.query("DELETE FROM users WHERE username = $1", [tmp]);
  server.close();

  console.log(`\nDemo data created.\n\nSign in with the password ${PASSWORD}:\n  warden  tech1  tech2  guard  manager   (staff)\n  20260001 ... 20260007             (students)\n  20270001, 20270002                (applicants with no room yet)\nPlus your own administrator account (default admin / Admin@12345).\n`);
}

main().then(() => process.exit(0)).catch((error) => { console.error("Demo seed failed:", error.message); process.exit(1); });
