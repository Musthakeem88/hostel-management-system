const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { ROLES } = require("../lib/roles");
const { bad, notFound, conflict } = require("../lib/http");
const { text, oneOf } = require("../lib/validate");
const { requireRole, hashPassword, checkPasswordStrength } = require("../lib/auth");
const { audit } = require("../lib/audit");

const router = express.Router();

const COLUMNS = `u.user_id, u.username, u.full_name, u.email, u.phone, u.role, u.status, u.student_number,
                 u.last_login, u.created_at, s.staff_number, s.position, s.hostel`;

// People who can be assigned work (maintenance staff) — wardens need this list too
router.get("/directory", requireRole("warden", "administrator"), async (req, res) => {
  const role = String(req.query.role || "maintenance");
  const result = await pool.query(
    "SELECT user_id, full_name, role FROM users WHERE status = 'Active' AND role = $1 ORDER BY full_name",
    [role]
  );
  res.json(result.rows);
});

router.get("/", requireRole("administrator"), async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.role && ROLES.includes(String(req.query.role))) {
    params.push(String(req.query.role));
    where.push(`u.role = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(u.username LIKE $${params.length} OR u.full_name LIKE $${params.length} OR u.email LIKE $${params.length})`);
  }

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM users u LEFT JOIN staff s ON s.user_id = u.user_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY u.user_id DESC`,
    params
  );
  res.json(result.rows);
});

function readUser(body, { creating }) {
  const role = oneOf(body.role, ROLES, "Role");
  const user = {
    role,
    full_name: text(body.full_name, "Full name", { required: true, max: 120 }),
    email: text(body.email, "Email", { max: 150 }),
    phone: text(body.phone, "Phone", { max: 30 }),
    student_number: text(body.student_number, "Student number", { max: 30 }),
    position: text(body.position, "Position", { max: 80 }),
    hostel: text(body.hostel, "Hostel", { max: 30 }),
    staff_number: text(body.staff_number, "Staff number", { max: 30 })
  };

  if (user.email && !/^\S+@\S+\.\S+$/.test(user.email)) throw bad("Enter a valid email address.");
  if (role === "student" && !user.student_number) throw bad("A student account needs the student number.");
  if (role !== "student") user.student_number = null;

  if (creating) {
    user.username = text(body.username, "Username", { required: true, max: 60 });
    if (!/^[A-Za-z0-9._@-]+$/.test(user.username)) throw bad("Username may only use letters, numbers and . _ - @");
  }

  return user;
}

async function saveStaffProfile(userId, u) {
  if (u.role === "student") {
    await pool.query("DELETE FROM staff WHERE user_id = $1", [userId]);
    return;
  }
  const has = await pool.query("SELECT 1 FROM staff WHERE user_id = $1", [userId]);
  if (has.rows.length) {
    await pool.query("UPDATE staff SET staff_number = $1, position = $2, hostel = $3 WHERE user_id = $4", [u.staff_number, u.position, u.hostel, userId]);
  } else {
    await pool.query("INSERT INTO staff (user_id, staff_number, position, hostel, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)", [userId, u.staff_number, u.position, u.hostel]);
  }
}

router.post("/", requireRole("administrator"), async (req, res) => {
  const u = readUser(req.body || {}, { creating: true });
  checkPasswordStrength(req.body.password);

  const taken = await pool.query("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)", [u.username]);
  if (taken.rows.length) throw conflict("That username is already taken.");

  const created = await pool.query(
    `INSERT INTO users (username, full_name, email, phone, role, password_hash, status, student_number, must_change_password, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, 1, CURRENT_TIMESTAMP)
     RETURNING user_id`,
    [u.username, u.full_name, u.email, u.phone, u.role, hashPassword(req.body.password), u.student_number]
  );

  const id = created.rows[0].user_id;
  await saveStaffProfile(id, u);
  if (u.role === "student") await pool.query("UPDATE students SET user_id = $1 WHERE student_number = $2", [id, u.student_number]);
  await audit(req, "create_user", "user", id, { username: u.username, role: u.role });

  res.status(201).json({ message: "User created. They must change the password at first sign-in.", user_id: id });
});

router.put("/:id", requireRole("administrator"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await pool.query("SELECT * FROM users WHERE user_id = $1", [id]);
  if (!existing.rows.length) throw notFound("User not found.");

  const u = readUser(req.body || {}, { creating: false });
  const status = oneOf(req.body.status || existing.rows[0].status, ["Active", "Disabled"], "Status");

  // Never lock everyone out: keep at least one active administrator
  if (existing.rows[0].role === "administrator" && (u.role !== "administrator" || status !== "Active")) {
    const admins = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role = 'administrator' AND status = 'Active'");
    if (Number(admins.rows[0].total) <= 1) throw bad("There must be at least one active administrator.");
  }

  await pool.query(
    `UPDATE users SET full_name = $1, email = $2, phone = $3, role = $4, status = $5, student_number = $6 WHERE user_id = $7`,
    [u.full_name, u.email, u.phone, u.role, status, u.student_number, id]
  );
  await saveStaffProfile(id, u);
  await audit(req, "update_user", "user", id, { role: u.role, status });

  res.json({ message: "User updated." });
});

router.post("/:id/reset-password", requireRole("administrator"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await pool.query("SELECT username FROM users WHERE user_id = $1", [id]);
  if (!existing.rows.length) throw notFound("User not found.");

  const password = req.body && req.body.password
    ? String(req.body.password)
    : crypto.randomBytes(6).toString("base64url") + "7a";
  checkPasswordStrength(password);

  await pool.query("UPDATE users SET password_hash = $1, must_change_password = 1 WHERE user_id = $2", [hashPassword(password), id]);
  await audit(req, "reset_password", "user", id);

  res.json({ message: "Password reset. Give the temporary password to the user; they must change it at next sign-in.", temporary_password: password });
});

module.exports = router;
