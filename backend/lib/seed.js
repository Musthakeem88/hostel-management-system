/* Start-up data that must always exist. Safe to run every time. */
const pool = require("../db");
const config = require("./config");
const logger = require("./logger");
const { hashPassword } = require("./auth");
const { ensureBeds } = require("./rooms");

const PROPERTY_TYPES = [
  // name, code, per bed?, fixed quantity, replacement cost (RM)
  ["Bed", "BD", 1, 0, 350], ["Mattress", "MT", 1, 0, 180], ["Desk", "DK", 1, 0, 220],
  ["Chair", "CH", 1, 0, 90], ["Wardrobe", "WD", 1, 0, 400], ["Key", "KY", 0, 1, 30],
  ["Mirror", "MR", 0, 1, 60], ["Ceiling fan", "FN", 0, 1, 150], ["Tube light", "LT", 0, 2, 25],
  ["Window", "WN", 0, 1, 300], ["Wall", "WL", 0, 1, 0], ["Sink", "SK", 0, 1, 200],
  ["Washroom items", "WS", 0, 1, 120]
];

const DEFAULT_SETTINGS = {
  deposit_amount: "300",
  hostel_fee_amount: "1200",
  fine_due_days: "14",
  late_return_time: "22:00",
  reminder_days_before_due: "3"
};

async function seed() {
  for (const [name, code, perBed, qty, cost] of PROPERTY_TYPES) {
    await pool.query(
      `INSERT INTO property_types (name, code, per_bed, standard_qty, replacement_cost)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING`,
      [name, code, perBed, qty, cost]
    );
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await pool.query("INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO NOTHING", [key, value]);
  }

  // hostels, floors and beds are derived from the existing rooms
  const rooms = (await pool.query("SELECT block, floor, room_number, capacity FROM rooms")).rows;

  for (const room of rooms) {
    const block = String(room.block).trim();
    await pool.query("INSERT INTO hostels (block, name, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (block) DO NOTHING", [block, `Block ${block}`]);
    await pool.query("INSERT INTO floors (block, floor, label) VALUES ($1, $2, $3) ON CONFLICT (block, floor) DO NOTHING", [block, room.floor, `Floor ${room.floor}`]);
    await ensureBeds(pool, room.block, room.floor, room.room_number, room.capacity);
  }

  // residents that already exist get their beds
  const residents = (await pool.query(
    `SELECT student_number, room_block, room_floor, room_number FROM students
     WHERE student_status IS NULL OR student_status = 'Active'`
  )).rows;

  for (const s of residents) {
    const has = await pool.query("SELECT 1 FROM beds WHERE student_number = $1", [s.student_number]);
    if (has.rows.length) continue;
    const free = await pool.query(
      `SELECT bed_id FROM beds WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND student_number IS NULL
       ORDER BY bed_number LIMIT 1`,
      [s.room_block, s.room_floor, s.room_number]
    );
    if (free.rows.length) {
      await pool.query("UPDATE beds SET student_number = $1, status = 'Occupied' WHERE bed_id = $2", [s.student_number, free.rows[0].bed_id]);
    }
  }

  // first administrator
  const users = await pool.query("SELECT COUNT(*) AS total FROM users");
  if (Number(users.rows[0].total) === 0) {
    await pool.query(
      `INSERT INTO users (username, full_name, email, role, password_hash, status, must_change_password, created_at)
       VALUES ($1, $2, NULL, 'administrator', $3, 'Active', $4, CURRENT_TIMESTAMP)`,
      [config.adminUsername, config.adminName, hashPassword(config.adminPassword), config.adminPassword === "Admin@12345" ? 1 : 0]
    );
    logger.warn("First administrator created", {
      username: config.adminUsername,
      note: config.adminPassword === "Admin@12345" ? "Default password in use — you will be asked to change it at first sign-in." : "Password from ADMIN_PASSWORD."
    });
  }
}

module.exports = { seed, PROPERTY_TYPES };
