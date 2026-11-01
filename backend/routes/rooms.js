const express = require("express");
const pool = require("../db");
const { bad, notFound, conflict } = require("../lib/http");
const { int, text, oneOf, parseRoomId, roomId } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { ensureBeds, createStandardItems } = require("../lib/rooms");

const router = express.Router();

const ROOM_TYPES = ["Single", "Double", "Triple", "Quad", "Standard"];
const VIEWERS = ["warden", "administrator", "maintenance", "security", "management"];

function describe(room) {
  return {
    ...room,
    room_type: room.room_type || "Standard",
    room_id: roomId(room.block, room.floor, room.room_number)
  };
}

function parseOr404(value) {
  const parsed = parseRoomId(value);
  if (!parsed) throw bad("Invalid room.");
  return parsed;
}

/* GET /api/rooms — all rooms (staff roles) */
router.get("/", requireRole(...VIEWERS), async (req, res) => {
  const result = await pool.query(`
    SELECT block, floor, room_number, capacity, occupied, under_maintenance, room_type
    FROM public.rooms
    ORDER BY block, floor, room_number
  `);

  res.json(result.rows.map(describe));
});

/* POST /api/rooms — add a room */
router.post("/", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const block = text(b.block, "Hostel block", { required: true, max: 10 });
  const floor = int(b.floor, "Floor");
  const number = int(b.room_number, "Room number");
  const capacity = int(b.capacity, "Capacity");
  const roomType = oneOf(b.room_type || "Standard", ROOM_TYPES, "Room type");

  if (capacity < 1 || capacity > 12) throw bad("Capacity must be between 1 and 12 beds.");
  if (floor < 0 || number < 0) throw bad("Floor and room number must be positive.");

  const exists = await pool.query("SELECT 1 FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [block, floor, number]);
  if (exists.rows.length) throw conflict("That room already exists.");

  await pool.query(
    `INSERT INTO rooms (block, floor, room_number, capacity, occupied, under_maintenance, room_type)
     VALUES ($1, $2, $3, $4, 0, FALSE, $5)`,
    [block, floor, number, capacity, roomType]
  );
  await pool.query("INSERT INTO hostels (block, name, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (block) DO NOTHING", [block, `Block ${block}`]);
  await pool.query("INSERT INTO floors (block, floor, label) VALUES ($1, $2, $3) ON CONFLICT (block, floor) DO NOTHING", [block, floor, `Floor ${floor}`]);
  await ensureBeds(pool, block, floor, number, capacity);

  let items = 0;
  if (b.standard_items) items = await createStandardItems(pool, block, floor, number, capacity, req.user.name);

  await audit(req, "create_room", "room", roomId(block, floor, number), { capacity, roomType, items });
  res.status(201).json({ message: `Room ${roomId(block, floor, number)} added${items ? ` with ${items} items` : ""}.`, room_id: roomId(block, floor, number) });
});

/* PUT /api/rooms/:roomId — change capacity / type / maintenance flag */
router.put("/:roomId", requireRole("administrator"), async (req, res) => {
  const r = parseOr404(req.params.roomId);
  const found = await pool.query("SELECT * FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [r.block, r.floor, r.number]);
  if (!found.rows.length) throw notFound("Room not found.");

  const room = found.rows[0];
  const b = req.body || {};
  const capacity = b.capacity == null ? Number(room.capacity) : int(b.capacity, "Capacity");
  const roomType = oneOf(b.room_type || room.room_type || "Standard", ROOM_TYPES, "Room type");
  const maintenance = b.under_maintenance == null ? Boolean(room.under_maintenance) : Boolean(b.under_maintenance);

  if (capacity < Number(room.occupied)) throw bad(`Capacity cannot be lower than the ${room.occupied} students already living there.`);
  if (capacity < 1 || capacity > 12) throw bad("Capacity must be between 1 and 12 beds.");

  await pool.query(
    "UPDATE rooms SET capacity = $1, room_type = $2, under_maintenance = $3 WHERE block = $4 AND floor = $5 AND room_number = $6",
    [capacity, roomType, maintenance, r.block, r.floor, r.number]
  );

  // keep the bed list in step with the capacity (only empty beds are ever removed)
  await ensureBeds(pool, r.block, r.floor, r.number, capacity);
  await pool.query(
    `DELETE FROM beds WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND bed_number > $4 AND student_number IS NULL`,
    [r.block, r.floor, r.number, capacity]
  );

  await audit(req, "update_room", "room", roomId(r.block, r.floor, r.number), { capacity, roomType, maintenance });
  res.json({ message: "Room updated." });
});

/* GET /api/rooms/:roomId/detail — items, beds and residents of one room */
router.get("/:roomId/detail", requireRole(...VIEWERS), async (req, res) => {
  const r = parseOr404(req.params.roomId);
  const found = await pool.query("SELECT * FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [r.block, r.floor, r.number]);
  if (!found.rows.length) throw notFound("Room not found.");

  const where = [r.block, r.floor, r.number];

  const items = await pool.query(
    `SELECT property_id, item_code, item_name, item_condition, status, acquired_date, repair_cost_total, replacement_cost
     FROM properties WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 ORDER BY item_name, item_code`, where);
  const beds = await pool.query(
    `SELECT bed_number, student_number, status FROM beds WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 ORDER BY bed_number`, where);
  const residents = await pool.query(
    `SELECT student_number, full_name, phone, check_in_date FROM students
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND (student_status IS NULL OR student_status = 'Active')`, where);

  res.json({
    room: describe(found.rows[0]),
    items: items.rows,
    beds: beds.rows,
    residents: residents.rows
  });
});

/* POST /api/rooms/:roomId/standard-items — create the standard item list for the room */
router.post("/:roomId/standard-items", requireRole("administrator"), async (req, res) => {
  const r = parseOr404(req.params.roomId);
  const found = await pool.query("SELECT capacity FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [r.block, r.floor, r.number]);
  if (!found.rows.length) throw notFound("Room not found.");

  const client = await pool.connect();
  let created;
  try {
    await client.query("BEGIN");
    created = await createStandardItems(client, r.block, r.floor, r.number, found.rows[0].capacity, req.user.name);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await audit(req, "standard_items", "room", roomId(r.block, r.floor, r.number), { created });
  res.json({ message: created ? `${created} items added to the room.` : "This room already has all standard items.", created });
});

module.exports = router;
