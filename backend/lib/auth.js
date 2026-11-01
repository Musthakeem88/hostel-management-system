/* Passwords (scrypt), signed login tokens (HMAC-SHA256) and role checks. No external packages. */
const crypto = require("crypto");
const pool = require("../db");
const config = require("./config");
const { bad, HttpError, forbidden } = require("./http");

/* ---------- passwords ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split("$");
    if (scheme !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function checkPasswordStrength(password) {
  const p = String(password || "");
  if (p.length < 8) throw bad("Password must be at least 8 characters.");
  if (p.length > 100) throw bad("Password is too long.");
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw bad("Password must contain letters and numbers.");
}

/* ---------- tokens ---------- */

const b64 = (buffer) => Buffer.from(buffer).toString("base64url");

function sign(text) {
  return b64(crypto.createHmac("sha256", config.jwtSecret).update(text).digest());
}

function signToken(payload, hours = config.tokenHours) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + hours * 3600 }));
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- middleware ---------- */

async function authenticate(req, res, next) {
  const header = String(req.headers.authorization || "");
  const payload = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;

  if (!payload) return next(new HttpError(401, "Please sign in."));

  const result = await pool.query(
    `SELECT user_id, username, full_name, role, status, student_number, must_change_password
     FROM users WHERE user_id = $1`,
    [payload.uid]
  );

  const user = result.rows[0];

  if (!user || user.status !== "Active") {
    return next(new HttpError(401, "This account is not active. Please sign in again."));
  }

  req.user = {
    id: user.user_id,
    username: user.username,
    name: user.full_name,
    role: user.role,
    studentNumber: user.student_number || null,
    mustChangePassword: Number(user.must_change_password) === 1
  };

  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, "Please sign in."));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/* ---------- login throttle (protects against password guessing) ---------- */

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function throttleCheck(key) {
  const entry = attempts.get(key);
  if (entry && Date.now() - entry.first > WINDOW_MS) attempts.delete(key);
  const current = attempts.get(key);
  if (current && current.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, "Too many failed sign-in attempts. Please wait 15 minutes and try again.");
  }
}

function throttleFail(key) {
  const entry = attempts.get(key) || { count: 0, first: Date.now() };
  entry.count += 1;
  attempts.set(key, entry);
}

function throttleReset(key) {
  attempts.delete(key);
}

module.exports = {
  hashPassword, verifyPassword, checkPasswordStrength, signToken, verifyToken,
  authenticate, requireRole, throttleCheck, throttleFail, throttleReset
};
