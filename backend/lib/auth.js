/* Passwords (scrypt), JWT login tokens (HS256) and role checks. No external packages. */
const crypto = require("crypto");
const pool = require("../db");
const config = require("./config");
const jwt = require("./jwt");
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

/* ---------- tokens (standard JWT) ---------- */

const jwtOptions = () => ({ secret: config.jwtSecret, issuer: config.jwtIssuer, audience: config.jwtAudience });

/* A short fingerprint of the user's current password. It is stored inside the token, so changing
   or resetting a password instantly makes every older token invalid. */
function passwordStamp(passwordHash) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`pwd:${passwordHash}`).digest("base64url").slice(0, 16);
}

/* Creates the JWT sent to the browser after sign-in. `user` is a row from the users table. */
function issueToken(user) {
  return jwt.sign(
    { role: user.role, pwd: passwordStamp(user.password_hash) },
    { ...jwtOptions(), subject: user.user_id, expiresInSeconds: Math.round(config.tokenHours * 3600) }
  );
}

function verifyToken(token) {
  return jwt.verify(token, jwtOptions());
}

/* Tokens that were signed out before they expired (kept in memory until their expiry time). */
const revoked = new Map();

function revokeToken(payload) {
  if (payload && payload.jti) revoked.set(payload.jti, payload.exp);
}

setInterval(() => {
  const now = Date.now() / 1000;
  for (const [id, exp] of revoked) if (exp < now) revoked.delete(id);
}, 10 * 60 * 1000).unref();

/* ---------- middleware ---------- */

async function authenticate(req, res, next) {
  const header = String(req.headers.authorization || "");
  const payload = header.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;

  if (!payload || revoked.has(payload.jti)) return next(new HttpError(401, "Please sign in."));

  const result = await pool.query(
    `SELECT user_id, username, full_name, role, status, student_number, must_change_password, password_hash
     FROM users WHERE user_id = $1`,
    [Number(payload.sub)]
  );

  const user = result.rows[0];

  if (!user || user.status !== "Active") {
    return next(new HttpError(401, "This account is not active. Please sign in again."));
  }

  // password changed (or role changed) since this token was issued -> sign in again
  if (payload.pwd !== passwordStamp(user.password_hash) || payload.role !== user.role) {
    return next(new HttpError(401, "Your session has expired. Please sign in again."));
  }

  req.tokenClaims = payload;
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
  hashPassword, verifyPassword, checkPasswordStrength, issueToken, verifyToken, revokeToken,
  authenticate, requireRole, throttleCheck, throttleFail, throttleReset
};
