const express = require("express");
const pool = require("../db");
const { bad, notFound, conflict } = require("../lib/http");
const { int, text, oneOf, money, roomFromBody, roomId, clean } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { roomExists, createProperty, addHistory } = require("../lib/rooms");

const router = express.Router();

const CONDITIONS = ["Good", "Damaged", "Broken"];
const STATUSES = ["In use", "Under repair", "Replaced", "Retired"];
const VIEW = ["warden", "administrator", "management"];

const withRoom = (row) => ({ ...row, room_id: roomId(row.room_block, row.room_floor, row.room_number) });

/* ---------- item types ---------- */

router.get("/types", requireRole("warden", "administrator", "management"), async (req, res) => {
  const result = await pool.query("SELECT * FROM property_types WHERE active = 1 ORDER BY name");
  res.json(result.rows);
});

router.post("/types", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, "Name", { required: true, max: 60 });
  const code = text(b.code, "Code", { required: true, max: 4 }).toUpperCase();
  const perBed = b.per_bed ? 1 : 0;
  const qty = int(b.standard_qty ?? 1, "Quantity per room");
  const cost = money(b.replacement_cost ?? 0, "Replacement cost");

  const exists = await pool.query("SELECT 1 FROM property_types WHERE LOWER(name) = LOWER($1)", [name]);
  if (exists.rows.length) throw conflict("That item type already exists.");

  await pool.query(
    "INSERT INTO property_types (name, code, per_bed, standard_qty, replacement_cost, active) VALUES ($1, $2, $3, $4, $5, 1)",
    [name, code, perBed, qty, cost]
  );
  await audit(req, "create_item_type", "item_type", name);
  res.status(201).json({ message: "Item type added." });
});

/* ---------- items ---------- */

router.get("/", requireRole(...VIEW), async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.room_id) {
    const room = roomFromBody({ room_id: req.query.room_id }, { required: false });
    if (room) {
      params.push(room.block, room.floor, room.number);
      where.push(`p.room_block = $${params.length - 2} AND p.room_floor = $${params.length - 1} AND p.room_number = $${params.length}`);
    }
  }
  if (req.query.status && STATUSES.includes(String(req.query.status))) { params.push(String(req.query.status)); where.push(`p.status = $${params.length}`); }
  if (req.query.condition && CONDITIONS.includes(String(req.query.condition))) { params.push(String(req.query.condition)); where.push(`p.item_condition = $${params.length}`); }
  if (req.query.q) { params.push(`%${clean(req.query.q)}%`); where.push(`(p.item_code LIKE $${params.length} OR p.item_name LIKE $${params.length})`); }

  const result = await pool.query(
    `SELECT p.property_id, p.item_code, p.item_name, p.room_block, p.room_floor, p.room_number, p.item_condition, p.status,
            to_char(p.acquired_date, 'YYYY-MM-DD') AS acquired_date, p.repair_cost_total, p.replacement_cost,
            (SELECT COUNT(*) FROM damage_reports d WHERE d.property_id = p.property_id) AS damage_count
     FROM properties p
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY p.room_block, p.room_floor, p.room_number, p.item_name, p.item_code
     LIMIT 1000`,
    params
  );

  res.json(result.rows.map((r) => withRoom({ ...r, damage_count: Number(r.damage_count) })));
});

router.post("/", requireRole("warden", "administrator"), async (req, res) => {
  const b = req.body || {};
  const room = roomFromBody(b);
  const type = (await pool.query("SELECT * FROM property_types WHERE type_id = $1", [int(b.type_id, "Item type")])).rows[0];

  if (!type) throw bad("Select a valid item type.");
  if (!(await roomExists(pool, room.block, room.floor, room.number))) throw notFound("Room not found.");

  const condition = oneOf(b.item_condition || "Good", CONDITIONS, "Condition");
  const client = await pool.connect();
  let created;
  try {
    await client.query("BEGIN");
    created = await createProperty(client, type, room.block, room.floor, room.number, { condition, actor: req.user.name, note: text(b.note, "Note", { max: 200 }) });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await audit(req, "create_item", "item", created.item_code);
  res.status(201).json({ message: `Item ${created.item_code} added.`, ...created });
});

router.get("/:id", requireRole(...VIEW), async (req, res) => {
  const id = int(req.params.id, "Item");
  const found = await pool.query(
    `SELECT p.*, t.name AS type_name, to_char(p.acquired_date, 'YYYY-MM-DD') AS acquired_on
     FROM properties p JOIN property_types t ON t.type_id = p.type_id WHERE p.property_id = $1`, [id]);
  if (!found.rows.length) throw notFound("Item not found.");

  const history = await pool.query(
    `SELECT history_id, event_type, to_char(event_date, 'YYYY-MM-DD') AS event_date, item_condition, note, student_number, actor
     FROM property_history WHERE property_id = $1 ORDER BY event_date, history_id`, [id]);
  const damages = await pool.query(
    `SELECT damage_id, report_number, description, damage_status, fine_status, fine_amount, student_number
     FROM damage_reports WHERE property_id = $1 ORDER BY damage_id DESC`, [id]);
  const repairs = await pool.query(
    `SELECT repair_id, request_number, description, repair_status, repair_cost FROM repair_requests WHERE property_id = $1 ORDER BY repair_id DESC`, [id]);

  res.json({ item: withRoom(found.rows[0]), history: history.rows, damages: damages.rows, repairs: repairs.rows });
});

router.put("/:id", requireRole("administrator"), async (req, res) => {
  const id = int(req.params.id, "Item");
  const found = await pool.query("SELECT * FROM properties WHERE property_id = $1", [id]);
  if (!found.rows.length) throw notFound("Item not found.");

  const item = found.rows[0];
  const b = req.body || {};
  const condition = oneOf(b.item_condition || item.item_condition, CONDITIONS, "Condition");
  const status = oneOf(b.status || item.status, STATUSES, "Status");
  const cost = b.replacement_cost == null ? Number(item.replacement_cost) : money(b.replacement_cost, "Replacement cost");
  const notes = b.notes === undefined ? item.notes : text(b.notes, "Notes", { max: 500 });
  const target = b.room_id ? roomFromBody({ room_id: b.room_id }) : null;

  if (target && !(await roomExists(pool, target.block, target.floor, target.number))) throw notFound("The new room does not exist.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (target && (target.block !== item.room_block || target.floor !== Number(item.room_floor) || target.number !== Number(item.room_number))) {
      await client.query("UPDATE room_properties SET removed_date = CURRENT_DATE WHERE property_id = $1 AND removed_date IS NULL", [id]);
      await client.query(
        "INSERT INTO room_properties (property_id, room_block, room_floor, room_number, assigned_date) VALUES ($1, $2, $3, $4, CURRENT_DATE)",
        [id, target.block, target.floor, target.number]);
      await client.query("UPDATE properties SET room_block = $1, room_floor = $2, room_number = $3 WHERE property_id = $4", [target.block, target.floor, target.number, id]);
      await addHistory(client, id, { event_type: "Moved", note: `Moved to room ${roomId(target.block, target.floor, target.number)}`, actor: req.user.name });
    }

    await client.query(
      "UPDATE properties SET item_condition = $1, status = $2, replacement_cost = $3, notes = $4 WHERE property_id = $5",
      [condition, status, cost, notes, id]);

    if (condition !== item.item_condition) await addHistory(client, id, { event_type: "Condition changed", item_condition: condition, note: `${item.item_condition} → ${condition}`, actor: req.user.name });
    if (status !== item.status) {
      const type = status === "Replaced" ? "Replaced" : status === "Retired" ? "Retired" : status === "In use" ? "Back in use" : "Under repair";
      await addHistory(client, id, { event_type: type, item_condition: condition, actor: req.user.name });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await audit(req, "update_item", "item", item.item_code, { condition, status });
  res.json({ message: "Item updated." });
});

/* Replace a worn-out or broken item with a new one in the same room */
router.post("/:id/replace", requireRole("administrator"), async (req, res) => {
  const id = int(req.params.id, "Item");
  const found = await pool.query("SELECT * FROM properties WHERE property_id = $1", [id]);
  if (!found.rows.length) throw notFound("Item not found.");

  const old = found.rows[0];
  if (old.status === "Replaced" || old.status === "Retired") throw conflict("This item has already been replaced or retired.");

  const type = (await pool.query("SELECT * FROM property_types WHERE type_id = $1", [old.type_id])).rows[0];
  const client = await pool.connect();
  let created;
  try {
    await client.query("BEGIN");
    await client.query("UPDATE properties SET status = 'Replaced' WHERE property_id = $1", [id]);
    await addHistory(client, id, { event_type: "Replaced", item_condition: old.item_condition, note: text(req.body && req.body.note, "Note", { max: 200 }) || "Replaced with a new item", actor: req.user.name });
    created = await createProperty(client, type, old.room_block, Number(old.room_floor), Number(old.room_number), { actor: req.user.name, note: `Replaces ${old.item_code}` });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await audit(req, "replace_item", "item", old.item_code, { new_item: created.item_code });
  res.json({ message: `${old.item_code} replaced by ${created.item_code}.`, ...created });
});

module.exports = router;
