const express = require("express");
const pool = require("../db");
const config = require("../lib/config");
const { PAGE_ACCESS, ROLE_LABELS } = require("../lib/roles");
const { bad, HttpError } = require("../lib/http");
const { clean, text } = require("../lib/validate");
const { audit } = require("../lib/audit");
const { notifyRoles } = require("../lib/notify");
const auth = require("../lib/auth");

const publicRouter = express.Router();   // no login needed
const privateRouter = express.Router();  // login needed (mounted after authenticate)

function describe(row) {
  return {
    id: row.user_id,
    username: row.username,
    name: row.full_name,
    email: row.email || null,
    phone: row.phone || null,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    studentNumber: row.student_number || null,
    mustChangePassword: Number(row.must_change_password) === 1,
    pages: PAGE_ACCESS[row.role] || ["dashboard", "profile"]
  };
}

/* POST /api/auth/login */
publicRouter.post("/login", async (req, res) => {
  const username = clean(req.body && req.body.username);
  const password = String((req.body && req.body.password) || "");

  if (!username || !password) throw bad("Enter your username and password.");

  const key = `${req.ip}|${username.toLowerCase()}`;
  auth.throttleCheck(key);

  const result = await pool.query(
    `SELECT * FROM users
     WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) OR student_number = $1
     ORDER BY user_id LIMIT 1`,
    [username]
  );
  const user = result.rows[0];

  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.throttleFail(key);
    await audit({ user: { username }, ip: req.ip }, "login_failed", "user", null, "Wrong username or password");
    throw new HttpError(401, "Wrong username or password.");
  }

  if (user.status !== "Active") throw new HttpError(403, "This account has been disabled. Please contact the hostel office.");

  auth.throttleReset(key);
  await pool.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1", [user.user_id]);
  await audit({ user: { id: user.user_id, username: user.username, role: user.role }, ip: req.ip }, "login", "user", user.user_id);

  res.json({ token: auth.signToken({ uid: user.user_id, role: user.role }), user: describe(user) });
});

/* POST /api/auth/register — a student creates their own account */
publicRouter.post("/register", async (req, res) => {
  if (!config.allowStudentSignup) throw new HttpError(403, "Student sign-up is turned off. Please ask the hostel office for an account.");

  const b = req.body || {};
  const studentNumber = text(b.student_number, "Student number", { required: true, max: 30 });
  const fullName = text(b.full_name, "Full name", { required: true, max: 120 });
  const email = text(b.email, "Email", { required: true, max: 150 });
  const phone = text(b.phone, "Phone", { max: 30 });

  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email address.");
  auth.checkPasswordStrength(b.password);

  // If the student is already registered by the hostel, the email must match our records.
  const known = await pool.query("SELECT email FROM students WHERE student_number = $1", [studentNumber]);
  if (known.rows.length && String(known.rows[0].email || "").toLowerCase() !== email.toLowerCase()) {
    throw bad("The student number and email do not match the hostel records. Please check them or contact the hostel office.");
  }

  const taken = await pool.query(
    "SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) OR student_number = $1 OR LOWER(email) = LOWER($2)",
    [studentNumber, email]
  );
  if (taken.rows.length) throw new HttpError(409, "An account already exists for this student number or email.");

  const created = await pool.query(
    `INSERT INTO users (username, full_name, email, phone, role, password_hash, status, student_number, created_at)
     VALUES ($1, $2, $3, $4, 'student', $5, 'Active', $1, CURRENT_TIMESTAMP)
     RETURNING *`,
    [studentNumber, fullName, email, phone, auth.hashPassword(b.password)]
  );

  const user = created.rows[0];
  await pool.query("UPDATE students SET user_id = $1 WHERE student_number = $2", [user.user_id, studentNumber]);
  await audit({ user: { id: user.user_id, username: user.username, role: "student" }, ip: req.ip }, "register", "user", user.user_id);

  res.status(201).json({ token: auth.signToken({ uid: user.user_id, role: "student" }), user: describe(user) });
});

/* GET /api/auth/me */
privateRouter.get("/me", async (req, res) => {
  const result = await pool.query("SELECT * FROM users WHERE user_id = $1", [req.user.id]);
  const unread = await pool.query("SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);

  res.json({ user: describe(result.rows[0]), unread: Number(unread.rows[0].total) });
});

/* POST /api/auth/change-password */
privateRouter.post("/change-password", async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const result = await pool.query("SELECT password_hash FROM users WHERE user_id = $1", [req.user.id]);

  if (!auth.verifyPassword(String(current_password || ""), result.rows[0].password_hash)) {
    throw bad("Your current password is not correct.");
  }

  auth.checkPasswordStrength(new_password);
  if (String(new_password) === String(current_password)) throw bad("Choose a new password that is different from the old one.");

  await pool.query("UPDATE users SET password_hash = $1, must_change_password = 0 WHERE user_id = $2", [auth.hashPassword(new_password), req.user.id]);
  await audit(req, "change_password", "user", req.user.id);

  res.json({ message: "Password changed successfully." });
});

/* POST /api/auth/logout — the browser discards the token; this records it */
privateRouter.post("/logout", async (req, res) => {
  await audit(req, "logout", "user", req.user.id);
  res.json({ message: "Signed out." });
});

module.exports = { publicRouter, privateRouter, describe };
