/* Shared helpers for rooms, beds and room items.
   `db` is either the pool or a transaction client — pass the client when inside a transaction. */
const { roomId, today, addDays } = require("./validate");

const pad2 = (n) => String(n).padStart(2, "0");

async function roomExists(db, block, floor, number) {
  const r = await db.query(
    "SELECT capacity, occupied, under_maintenance FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3",
    [block, floor, number]
  );
  return r.rows[0] || null;
}

/* ---------- beds ---------- */

async function ensureBeds(db, block, floor, number, capacity) {
  const existing = await db.query(
    "SELECT bed_number FROM beds WHERE room_block = $1 AND room_floor = $2 AND room_number = $3",
    [block, floor, number]
  );
  const have = new Set(existing.rows.map((r) => Number(r.bed_number)));

  for (let bed = 1; bed <= Number(capacity); bed += 1) {
    if (!have.has(bed)) {
      await db.query(
        `INSERT INTO beds (room_block, room_floor, room_number, bed_number, status)
         VALUES ($1, $2, $3, $4, 'Available')`,
        [block, floor, number, bed]
      );
    }
  }
}

async function assignBed(db, studentNumber, block, floor, number) {
  await db.query(
    "UPDATE beds SET student_number = NULL, status = 'Available' WHERE student_number = $1",
    [studentNumber]
  );

  const free = await db.query(
    `SELECT bed_id FROM beds
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND student_number IS NULL
     ORDER BY bed_number LIMIT 1`,
    [block, floor, number]
  );

  if (free.rows.length) {
    await db.query("UPDATE beds SET student_number = $1, status = 'Occupied' WHERE bed_id = $2", [studentNumber, free.rows[0].bed_id]);
  }
}

async function freeBed(db, studentNumber) {
  await db.query("UPDATE beds SET student_number = NULL, status = 'Available' WHERE student_number = $1", [studentNumber]);
}

/* ---------- room items ---------- */

async function addHistory(db, propertyId, { event_type, item_condition, note, student_number, ref_type, ref_id, actor }) {
  await db.query(
    `INSERT INTO property_history
       (property_id, event_type, event_date, item_condition, note, student_number, ref_type, ref_id, actor, created_at)
     VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
    [propertyId, event_type, item_condition || null, note || null, student_number || null, ref_type || null, ref_id ?? null, actor || null]
  );
}

async function nextItemCode(db, typeCode, block, floor, number) {
  const stem = `${typeCode}-${String(block).replace(/\s+/g, "")}${floor}${pad2(number)}`;
  const existing = await db.query("SELECT item_code FROM properties WHERE item_code LIKE $1", [`${stem}-%`]);
  const used = new Set(existing.rows.map((r) => r.item_code));

  for (let seq = 1; seq < 1000; seq += 1) {
    const code = `${stem}-${pad2(seq)}`;
    if (!used.has(code)) return code;
  }
  throw new Error("Could not generate an item code.");
}

async function createProperty(db, type, block, floor, number, { condition = "Good", actor, note } = {}) {
  const code = await nextItemCode(db, type.code, block, floor, number);

  const inserted = await db.query(
    `INSERT INTO properties
       (item_code, type_id, item_name, room_block, room_floor, room_number, item_condition, status,
        acquired_date, replacement_cost, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'In use', CURRENT_DATE, $8, CURRENT_TIMESTAMP)
     RETURNING property_id, item_code`,
    [code, type.type_id, type.name, block, floor, number, condition, type.replacement_cost || 0]
  );

  const id = inserted.rows[0].property_id;

  await db.query(
    `INSERT INTO room_properties (property_id, room_block, room_floor, room_number, assigned_date)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)`,
    [id, block, floor, number]
  );
  await addHistory(db, id, { event_type: "New", item_condition: condition, note: note || "Item added to the room", actor });

  return { property_id: id, item_code: code };
}

// Creates the standard set of university items for a room (beds, desks, chairs... scaled by capacity)
async function createStandardItems(db, block, floor, number, capacity, actor) {
  const types = (await db.query("SELECT * FROM property_types WHERE active = 1 ORDER BY type_id")).rows;
  const existing = await db.query(
    "SELECT type_id FROM properties WHERE room_block = $1 AND room_floor = $2 AND room_number = $3",
    [block, floor, number]
  );
  const haveTypes = new Set(existing.rows.map((r) => Number(r.type_id)));
  let created = 0;

  for (const type of types) {
    if (haveTypes.has(Number(type.type_id))) continue; // never duplicate a type that is already there
    const quantity = Number(type.per_bed) === 1 ? Number(capacity) : Number(type.standard_qty);

    for (let i = 0; i < quantity; i += 1) {
      await createProperty(db, type, block, floor, number, { actor });
      created += 1;
    }
  }

  return created;
}

/* Management cleans a room when a new student arrives: create one open cleaning job per room. */
async function ensureCleaningJob(db, block, floor, number, { studentNumber, userId } = {}) {
  const open = await db.query(
    `SELECT 1 FROM maintenance_requests
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3
       AND maintenance_type = 'Cleaning' AND status <> 'Completed'`,
    [block, floor, number]
  );
  if (open.rows.length) return false;

  await db.query(
    `INSERT INTO maintenance_requests
       (room_block, room_floor, room_number, maintenance_type, description, status,
        reported_date, expected_completion_date, created_by, created_at)
     VALUES ($1, $2, $3, 'Cleaning', $4, 'Pending', CURRENT_DATE, $5, $6, CURRENT_TIMESTAMP)`,
    [block, floor, number, `Clean the room before the new student arrives${studentNumber ? ` (${studentNumber})` : ""}.`, addDays(today(), 1), userId ?? null]
  );
  return true;
}

module.exports = {
  ensureCleaningJob, roomId, roomExists, ensureBeds, assignBed, freeBed, addHistory, createProperty, createStandardItems, nextItemCode
};
