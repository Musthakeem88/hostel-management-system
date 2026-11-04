/* Shared set-up for the automated tests: an in-memory database, the real app, and small helpers. */
process.env.DB_DRIVER = "sqlite";
process.env.LOG_LEVEL = "silent";
process.env.SCHEDULER = "off";
process.env.JWT_SECRET = "test-secret";
process.env.ADMIN_PASSWORD = "Admin@12345";
process.env.UPLOAD_DIR = require("path").join(require("os").tmpdir(), `hostel-test-${process.pid}`);

const pool = require("../db");
const { createApp } = require("../server");
const { hashPassword } = require("../lib/auth");

// 1x1 pixel PNG and JPEG used as test photos
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function boot() {
  const app = await createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, token) {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : type.includes("text") ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }

  async function login(username, password) {
    const r = await call("POST", "/api/auth/login", { username, password });
    if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.data)}`);
    return r.data.token;
  }

  // admin first (password change not needed in tests because we reset the flag)
  await pool.query("UPDATE users SET must_change_password = 0");
  const tokens = { administrator: await login("admin", "Admin@12345") };

  async function addUser(username, role, extra = {}) {
    await pool.query(
      `INSERT INTO users (username, full_name, email, role, password_hash, status, student_number, created_at)
       VALUES ($1, $2, $3, $4, $5, 'Active', $6, CURRENT_TIMESTAMP)`,
      [username, extra.name || username, `${username}@test.edu`, role, hashPassword("Passw0rd!"), extra.student || null]
    );
    return login(username, "Passw0rd!");
  }

  async function photo(token) {
    const r = await call("POST", "/api/files", { data: `data:image/png;base64,${PNG}`, name: "t.png", purpose: "photo" }, token);
    if (r.status !== 201) throw new Error("photo upload failed " + JSON.stringify(r.data));
    return r.data.id;
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve));
  }

  return { base, call, login, addUser, photo, tokens, pool, close, PNG };
}

/* A small campus used by most tests: 3 rooms with items, one user per role, two residents. */
async function campus(t) {
  const admin = t.tokens.administrator;
  const room = (block, floor, number, capacity, type) =>
    t.call("POST", "/api/rooms", { block, floor, room_number: number, capacity, room_type: type, standard_items: true }, admin);

  await room("A", 1, 1, 2, "Double");
  await room("A", 1, 2, 1, "Single");
  await room("B", 1, 1, 2, "Double");

  const tokens = {
    admin,
    warden: await t.addUser("warden1", "warden", { name: "Wendy Warden" }),
    tech: await t.addUser("tech1", "maintenance", { name: "Tom Tech" }),
    tech2: await t.addUser("tech2", "maintenance", { name: "Tina Tech" }),
    guard: await t.addUser("guard1", "security", { name: "Gary Guard" }),
    boss: await t.addUser("boss1", "management", { name: "Mia Manager" })
  };

  const reg = (number, name, block, floor, roomNo) =>
    t.call("POST", "/api/students", { student_number: number, full_name: name, email: `${number}@uni.edu`, phone: "012-111", room_block: block, room_floor: floor, room_number: roomNo, faculty: "Engineering" }, tokens.warden);

  // the students already have logins when the hostel allocates their rooms
  tokens.ann = await t.addUser("20260001", "student", { name: "Ann Student", student: "20260001" });
  tokens.ben = await t.addUser("20260002", "student", { name: "Ben Student", student: "20260002" });

  await reg("20260001", "Ann Student", "A", 1, 1);
  await reg("20260002", "Ben Student", "A", 1, 1);

  return tokens;
}

module.exports = { boot, campus, PNG };
