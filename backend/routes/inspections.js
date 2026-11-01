const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict } = require("../lib/http");
const { text, oneOf, roomFromBody, roomId, clean } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyRoles, notifyStudent, notifyUsers } = require("../lib/notify");
const { checkPhotoIds, refsFromJson } = require("../lib/photos");
const { addHistory } = require("../lib/rooms");
const { compare, inspectionItems } = require("../lib/compare");

const router = express.Router();

const CONDITIONS = ["Good", "Damaged", "Broken"];
const DEFAULT_ITEMS = ["Bed", "Mattress", "Desk", "Chair", "Wardrobe", "Ceiling fan", "Tube light", "Window", "Sink", "Mirror"];
const STAFF_VIEW = ["warden", "administrator", "management"];

async function present(row) {
  return {
    ...row,
    room_id: roomId(row.room_block, row.room_floor, row.room_number),
    confirmation_status: row.confirmation_status || "Not required",
    items: await inspectionItems(row)
  };
}

function canSee(req, inspection) {
  return STAFF_VIEW.includes(req.user.role) ||
    (req.user.role === "student" && req.user.studentNumber === inspection.student_number);
}

/* GET /api/inspections — staff see all; students see their own */
router.get("/", requireRole("warden", "administrator", "management", "student"), async (req, res) => {
  const isStudent = req.user.role === "student";
  const result = await pool.query(
    `SELECT * FROM public.inspections
     ${isStudent ? "WHERE student_number = $1" : ""}
     ORDER BY inspection_date DESC, inspection_id DESC
     LIMIT 300`,
    isStudent ? [req.user.studentNumber || ""] : []
  );

  res.json(await Promise.all(result.rows.map(present)));
});

/* GET /api/inspections/room-items?room_id=A-01-01 — the checklist for a room */
router.get("/room-items", requireRole("warden", "administrator"), async (req, res) => {
  const room = roomFromBody({ room_id: req.query.room_id });
  const items = await pool.query(
    `SELECT property_id, item_code, item_name, item_condition FROM properties
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND status IN ('In use', 'Under repair')
     ORDER BY item_name, item_code`,
    [room.block, room.floor, room.number]
  );
  const residents = await pool.query(
    `SELECT student_number, full_name FROM students
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND (student_status IS NULL OR student_status = 'Active')`,
    [room.block, room.floor, room.number]
  );

  res.json({
    room_id: roomId(room.block, room.floor, room.number),
    items: items.rows.length
      ? items.rows.map((i) => ({ property_id: i.property_id, item: i.item_name, item_code: i.item_code, last_condition: i.item_condition }))
      : DEFAULT_ITEMS.map((name) => ({ property_id: null, item: name, item_code: null, last_condition: "Good" })),
    from_inventory: items.rows.length > 0,
    residents: residents.rows
  });
});

/* POST /api/inspections — record a check-in or check-out inspection */
router.post("/", requireRole("warden", "administrator"), async (req, res) => {
  const b = req.body || {};

  if (
    !b.room_block && !b.room_id ||
    typeof b.student_number !== "string" || !b.student_number.trim() ||
    !["Check-in", "Check-out"].includes(b.inspection_type) ||
    !Array.isArray(b.inspection_items)
  ) {
    return res.status(400).json({ error: "Please provide all required inspection details." });
  }

  const room = roomFromBody(b);
  const studentNumber = b.student_number.trim();
  const type = b.inspection_type;

  if (!b.inspection_items.length) throw bad("Add at least one item to the inspection.");
  if (b.inspection_items.length > 60) throw bad("An inspection can have at most 60 items.");

  const student = await pool.query(
    `SELECT student_id FROM students WHERE student_number = $1 AND room_block = $2 AND room_floor = $3 AND room_number = $4`,
    [studentNumber, room.block, room.floor, room.number]);
  if (!student.rows.length) return res.status(400).json({ error: "The student is not assigned to the selected room." });

  // check every item and its photos
  const items = [];
  let photoTotal = 0;

  for (const raw of b.inspection_items) {
    const name = text(raw.item, "Item name", { required: true, max: 80 });
    const condition = oneOf(raw.condition, CONDITIONS, `Condition of ${name}`);
    const photoIds = await checkPhotoIds(raw.photo_ids, { max: 6 });
    photoTotal += photoIds.length;

    if (condition !== "Good" && photoIds.length === 0) throw bad(`Add a photo of the ${name} — items that are not in good condition need photo proof.`);

    let propertyId = null;
    let code = null;
    if (raw.property_id != null && raw.property_id !== "") {
      const p = await pool.query(
        "SELECT property_id, item_code FROM properties WHERE property_id = $1 AND room_block = $2 AND room_floor = $3 AND room_number = $4",
        [Number(raw.property_id), room.block, room.floor, room.number]);
      if (!p.rows.length) throw bad(`${name} does not belong to this room.`);
      propertyId = p.rows[0].property_id;
      code = p.rows[0].item_code;
    }

    items.push({ propertyId, code, name, condition, note: text(raw.note, "Note", { max: 300 }) || "", photoIds });
  }

  if (type === "Check-in" && photoTotal === 0) throw bad("A check-in inspection needs photos of the room.");

  const client = await pool.connect();
  let inspection;

  try {
    await client.query("BEGIN");

    inspection = (await client.query(
      `INSERT INTO public.inspections
         (room_block, room_floor, room_number, student_number, inspection_type, inspection_items,
          inspector_user_id, inspector_name, confirmation_status, general_notes, inspection_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
       RETURNING *`,
      [room.block, room.floor, room.number, studentNumber, type,
       JSON.stringify(items.map((i) => ({ item: i.name, condition: i.condition, note: i.note }))),
       req.user.id, req.user.name, type === "Check-in" ? "Pending" : "Not required", text(b.general_notes, "Notes", { max: 500 })]
    )).rows[0];

    for (const i of items) {
      await client.query(
        `INSERT INTO inspection_items (inspection_id, property_id, item_name, item_code, item_condition, note, photo_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [inspection.inspection_id, i.propertyId, i.name, i.code, i.condition, i.note, JSON.stringify(i.photoIds)]
      );

      if (i.propertyId) {
        await client.query("UPDATE properties SET item_condition = $1 WHERE property_id = $2", [i.condition, i.propertyId]);
        await addHistory(client, i.propertyId, {
          event_type: "Condition checked", item_condition: i.condition,
          note: `${type}: ${i.condition}${i.note ? " — " + i.note : ""}`, student_number: studentNumber,
          ref_type: "inspection", ref_id: inspection.inspection_id, actor: req.user.name
        });
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const where = roomId(room.block, room.floor, room.number);
  let comparison = null;

  if (type === "Check-in") {
    await notifyStudent(studentNumber, { title: "Please confirm your room condition", message: `A check-in inspection was recorded for room ${where}. Review it and confirm.`, type: "inspection", page: "myroom", related_id: inspection.inspection_id });
  } else {
    comparison = await compare(inspection);
    await notifyStudent(studentNumber, { title: "Check-out inspection recorded", message: `Your check-out inspection for room ${where} was recorded.`, type: "inspection", page: "myroom", related_id: inspection.inspection_id });
    if (comparison.new_damage > 0) {
      await notifyRoles(["administrator"], { title: "New damage found at check-out", message: `${comparison.new_damage} new damage item(s) in room ${where} (student ${studentNumber}).`, type: "inspection", page: "inspections", related_id: inspection.inspection_id });
    }
  }

  await audit(req, "inspection", "inspection", inspection.inspection_id, { type, room: where, student: studentNumber });

  res.status(201).json({
    message: "Inspection saved successfully.",
    inspection: await present(inspection),
    comparison
  });
});

/* GET /api/inspections/:id */
router.get("/:id", requireRole("warden", "administrator", "management", "student"), async (req, res) => {
  const found = await pool.query("SELECT * FROM inspections WHERE inspection_id = $1", [Number(req.params.id)]);
  if (!found.rows.length) throw notFound("Inspection not found.");
  if (!canSee(req, found.rows[0])) throw forbidden();

  res.json(await present(found.rows[0]));
});

/* GET /api/inspections/:id/compare — check-out against the check-in */
router.get("/:id/compare", requireRole("warden", "administrator", "management", "student"), async (req, res) => {
  const found = await pool.query("SELECT * FROM inspections WHERE inspection_id = $1", [Number(req.params.id)]);
  if (!found.rows.length) throw notFound("Inspection not found.");
  if (!canSee(req, found.rows[0])) throw forbidden();
  if (found.rows[0].inspection_type !== "Check-out") throw bad("Only a check-out inspection can be compared with the check-in.");

  res.json(await compare(found.rows[0]));
});

/* POST /api/inspections/:id/confirm — the student confirms (or disputes) the check-in */
router.post("/:id/confirm", requireRole("student"), async (req, res) => {
  const found = await pool.query("SELECT * FROM inspections WHERE inspection_id = $1", [Number(req.params.id)]);
  if (!found.rows.length) throw notFound("Inspection not found.");

  const inspection = found.rows[0];
  if (inspection.student_number !== req.user.studentNumber) throw forbidden("This is not your inspection.");
  if (inspection.inspection_type !== "Check-in") throw bad("Only check-in inspections need your confirmation.");
  if (inspection.confirmation_status !== "Pending") throw conflict(`This inspection is already ${String(inspection.confirmation_status).toLowerCase()}.`);

  const action = oneOf(req.body && req.body.action, ["confirm", "dispute"], "Action");
  const comment = text(req.body && req.body.comment, "Comment", { max: 500 });
  if (action === "dispute" && !comment) throw bad("Tell us what is wrong with the recorded condition.");

  await pool.query(
    `UPDATE inspections SET confirmation_status = $1, student_confirmed_at = CURRENT_TIMESTAMP, student_comment = $2
     WHERE inspection_id = $3`,
    [action === "confirm" ? "Confirmed" : "Disputed", comment, inspection.inspection_id]
  );

  const where = roomId(inspection.room_block, inspection.room_floor, inspection.room_number);
  await notifyUsers([inspection.inspector_user_id], {
    title: action === "confirm" ? "Check-in confirmed by student" : "Student disputes the check-in",
    message: `${req.user.name} ${action === "confirm" ? "confirmed" : "disputed"} the check-in for room ${where}.${comment ? " " + comment : ""}`,
    type: "inspection", page: "inspections", related_id: inspection.inspection_id
  });
  if (action === "dispute") await notifyRoles(["warden"], { title: "Student disputes the check-in", message: `Room ${where}: ${comment}`, type: "inspection", page: "inspections", related_id: inspection.inspection_id });
  await audit(req, action === "confirm" ? "confirm_checkin" : "dispute_checkin", "inspection", inspection.inspection_id);

  res.json({ message: action === "confirm" ? "Thank you — the room condition is confirmed." : "Your objection was sent to the warden." });
});

module.exports = router;
