/* Small input-checking helpers shared by all routes. */
const crypto = require("crypto");
const { bad } = require("./http");

const clean = (value) => String(value ?? "").trim();

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function text(value, label, { required = false, max = 255 } = {}) {
  const v = clean(value);
  if (required && !v) throw bad(`${label} is required.`);
  if (v.length > max) throw bad(`${label} is too long (max ${max} characters).`);
  return v || null;
}

function oneOf(value, list, label) {
  const v = clean(value);
  if (!list.includes(v)) throw bad(`${label} must be one of: ${list.join(", ")}.`);
  return v;
}

function date(value, label, { required = false } = {}) {
  const v = clean(value);
  if (!v) {
    if (required) throw bad(`${label} is required.`);
    return null;
  }
  if (!isDate(v)) throw bad(`${label} is not a valid date (use YYYY-MM-DD).`);
  return v;
}

function money(value, label, { required = true, allowZero = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(`${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) throw bad(`${label} must be a valid amount.`);
  return Math.round(n * 100) / 100;
}

function int(value, label, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw bad(`${label} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw bad(`${label} must be a whole number.`);
  return n;
}

// "A-01-02" -> { block: "A", floor: 1, number: 2 }
function parseRoomId(value) {
  const m = /^(.+)-(\d+)-(\d+)$/.exec(clean(value));
  if (!m) return null;
  return { block: m[1].trim(), floor: Number(m[2]), number: Number(m[3]) };
}

function roomId(block, floor, number) {
  return `${String(block).trim()}-${String(floor).padStart(2, "0")}-${String(number).padStart(2, "0")}`;
}

// Reads room from body: either room_id, or room_block / room_floor / room_number
function roomFromBody(body, { required = true } = {}) {
  const b = body || {};
  let room = null;

  if (b.room_id) room = parseRoomId(b.room_id);
  else if (b.room_block && b.room_floor != null && b.room_number != null) {
    room = { block: clean(b.room_block), floor: Number(b.room_floor), number: Number(b.room_number) };
  }

  if (!room || !Number.isInteger(room.floor) || !Number.isInteger(room.number)) {
    if (required) throw bad("Select a valid room.");
    return null;
  }

  return room;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// Business number such as INV-MGSFJZWG1A2B3C (at most 18 characters, fits VARCHAR(20)):
// the time in base 36 plus 24 random bits, so two numbers made in the same millisecond never clash
function businessNumber(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

module.exports = {
  clean, isDate, today, addDays, text, oneOf, date, money, int,
  parseRoomId, roomId, roomFromBody, parseJson, businessNumber
};
