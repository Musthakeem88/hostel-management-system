const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict } = require("../lib/http");
const { text, oneOf, money, roomFromBody, roomId, businessNumber, int } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyRoles, notifyStudent, notifyUsers } = require("../lib/notify");
const { checkPhotoIds, entityPhotos, attachPhotos } = require("../lib/photos");
const { addHistory } = require("../lib/rooms");

const router = express.Router();

const STATUSES = ["Reported", "Assigned", "In Progress", "Completed"];
const PRIORITIES = ["Low", "Normal", "Urgent"];

const COLUMNS = `r.repair_id, r.request_number, r.room_block, r.room_floor, r.room_number, r.item_name, r.description,
  r.priority, r.repair_status, r.created_at, r.assigned_user_id, r.assigned_name, r.student_number, r.reported_by,
  r.repair_cost, r.resolution_note, r.assigned_at, r.started_at, r.completed_at, r.property_id,
  (SELECT COUNT(*) FROM entity_files e WHERE e.entity_type = 'repair' AND e.entity_id = r.repair_id) AS photo_count`;

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(/[zZ]|[+-]\d\d(:?\d\d)?$/.test(s) ? s.replace(" ", "T") : s.replace(" ", "T") + "Z");
}

function hoursBetween(from, to) {
  const a = asDate(from);
  const b = asDate(to);
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round(((b - a) / 36e5) * 10) / 10;
}

const present = (r) => ({
  ...r,
  room_id: roomId(r.room_block, r.room_floor, r.room_number),
  photo_count: Number(r.photo_count || 0),
  repair_cost: Number(r.repair_cost || 0),
  hours_taken: r.repair_status === "Completed" ? hoursBetween(r.created_at, r.completed_at) : null
});

async function load(id) {
  const r = await pool.query(`SELECT ${COLUMNS} FROM repair_requests r WHERE r.repair_id = $1`, [id]);
  if (!r.rows.length) throw notFound("Repair request not found.");
  return r.rows[0];
}

function mayTouch(req, repair) {
  if (["warden", "administrator"].includes(req.user.role)) return true;
  if (req.user.role === "maintenance") return Number(repair.assigned_user_id) === req.user.id;
  if (req.user.role === "student") return repair.student_number === req.user.studentNumber || Number(repair.reported_by) === req.user.id;
  return false;
}

/* GET /api/repairs */
router.get("/", requireRole("student", "warden", "administrator", "maintenance", "management"), async (req, res) => {
  const params = [];
  let where = "";

  if (req.user.role === "student") { params.push(req.user.studentNumber || "", req.user.id); where = "WHERE r.student_number = $1 OR r.reported_by = $2"; }
  if (req.user.role === "maintenance") { params.push(req.user.id); where = "WHERE r.assigned_user_id = $1"; }

  const result = await pool.query(
    `SELECT ${COLUMNS} FROM public.repair_requests r ${where} ORDER BY r.created_at DESC, r.repair_id DESC LIMIT 500`, params);
  res.json(result.rows.map(present));
});

/* GET /api/repairs/:id */
router.get("/:id", requireRole("student", "warden", "administrator", "maintenance", "management"), async (req, res) => {
  const repair = await load(int(req.params.id, "Repair"));
  if (req.user.role !== "management" && !mayTouch(req, repair)) throw forbidden();
  res.json({ repair: present(repair), photos: await entityPhotos("repair", repair.repair_id) });
});

/* POST /api/repairs — report a problem */
router.post("/", requireRole("student", "warden", "administrator"), async (req, res) => {
  const b = req.body || {};
  const isStudent = req.user.role === "student";
  let room;
  let studentNumber = null;

  if (isStudent) {
    const mine = await pool.query(
      "SELECT room_block, room_floor, room_number FROM students WHERE student_number = $1 AND (student_status IS NULL OR student_status = 'Active')",
      [req.user.studentNumber || ""]);
    if (!mine.rows.length) throw bad("You need an allocated room before you can report a problem.");
    room = { block: mine.rows[0].room_block, floor: Number(mine.rows[0].room_floor), number: Number(mine.rows[0].room_number) };
    studentNumber = req.user.studentNumber;
  } else {
    if (!(b.room_id || b.room_block) || typeof b.item_name !== "string" || !b.item_name.trim() || typeof b.description !== "string" || !b.description.trim()) {
      return res.status(400).json({ error: "Please provide valid repair request details." });
    }
    room = roomFromBody(b);
    studentNumber = text(b.student_number, "Student number", { max: 30 });
  }

  if (typeof b.item_name !== "string" || !b.item_name.trim() || typeof b.description !== "string" || !b.description.trim()) {
    return res.status(400).json({ error: "Please provide valid repair request details." });
  }

  const priority = oneOf(b.priority || "Normal", PRIORITIES, "Priority");
  const photoIds = await checkPhotoIds(b.photo_ids, { max: 6 });

  const exists = await pool.query("SELECT 1 FROM public.rooms WHERE block = $1 AND floor = $2 AND room_number = $3", [room.block, room.floor, room.number]);
  if (!exists.rows.length) return res.status(404).json({ error: "Room not found." });

  const prop = await pool.query(
    `SELECT property_id FROM properties WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND LOWER(item_name) = LOWER($4)
     ORDER BY property_id LIMIT 1`, [room.block, room.floor, room.number, b.item_name.trim()]);

  const created = await pool.query(
    `INSERT INTO public.repair_requests
       (request_number, room_block, room_floor, room_number, item_name, description, priority, repair_status,
        reported_by, student_number, property_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'Reported', $8, $9, $10, CURRENT_TIMESTAMP)
     RETURNING repair_id`,
    [businessNumber("REP"), room.block, room.floor, room.number, b.item_name.trim(), b.description.trim(), priority, req.user.id, studentNumber,
     prop.rows.length ? prop.rows[0].property_id : null]
  );

  const id = created.rows[0].repair_id;
  await attachPhotos("repair", id, photoIds, req.user.id);
  const repair = present(await load(id));

  const where = roomId(room.block, room.floor, room.number);
  await notifyRoles(priority === "Urgent" ? ["warden", "administrator"] : ["warden"], {
    title: priority === "Urgent" ? "URGENT repair request" : "New repair request",
    message: `${repair.item_name} in room ${where}: ${repair.description.slice(0, 100)}`, type: "repair", page: "repairs", related_id: id
  });
  await audit(req, "create_repair", "repair", id, { room: where, priority });

  res.status(201).json({ message: "Repair request created successfully.", repair });
});

/* POST /api/repairs/:id/assign — give the job to maintenance staff */
router.post("/:id/assign", requireRole("warden", "administrator"), async (req, res) => {
  const repair = await load(int(req.params.id, "Repair"));
  if (repair.repair_status === "Completed") throw conflict("Completed repair requests cannot be changed.");

  const staff = await pool.query("SELECT user_id, full_name FROM users WHERE user_id = $1 AND role = 'maintenance' AND status = 'Active'", [int(req.body && req.body.user_id, "Staff member")]);
  if (!staff.rows.length) throw bad("Choose an active maintenance staff member.");

  const s = staff.rows[0];
  await pool.query(
    `UPDATE repair_requests SET assigned_user_id = $1, assigned_name = $2,
            repair_status = CASE WHEN repair_status = 'Reported' THEN 'Assigned' ELSE repair_status END,
            assigned_at = CURRENT_TIMESTAMP WHERE repair_id = $3`,
    [s.user_id, s.full_name, repair.repair_id]);

  const where = roomId(repair.room_block, repair.room_floor, repair.room_number);
  await notifyUsers([s.user_id], { title: "New repair job", message: `${repair.item_name} in room ${where} (${repair.priority} priority).`, type: "repair", page: "repairs", related_id: repair.repair_id });
  await notifyStudent(repair.student_number, { title: "Your repair request was assigned", message: `${s.full_name} will look at the ${repair.item_name}.`, type: "repair", page: "repairs", related_id: repair.repair_id });
  await audit(req, "assign_repair", "repair", repair.repair_id, { to: s.full_name });

  res.json({ message: `Assigned to ${s.full_name}.` });
});

/* PATCH /api/repairs/:id/status — progress, cost and notes */
router.patch("/:id/status", requireRole("warden", "administrator", "maintenance"), async (req, res) => {
  const status = String(req.body?.status ?? "").trim();
  const repairId = Number(req.params.id);

  if (!Number.isInteger(repairId) || repairId <= 0) return res.status(400).json({ error: "Invalid repair ID." });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `Invalid repair status: "${status}".`, received: req.body?.status ?? null, allowedStatuses: STATUSES });

  const repair = await load(repairId);
  if (repair.repair_status === "Completed") throw conflict("Completed repair requests cannot be changed.");
  if (!mayTouch(req, repair)) throw forbidden("This job is not assigned to you.");

  const cost = req.body.repair_cost == null || req.body.repair_cost === "" ? null : money(req.body.repair_cost, "Repair cost");
  const note = text(req.body.resolution_note, "Note", { max: 500 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE repair_requests SET repair_status = $1,
              repair_cost = COALESCE($2, repair_cost), resolution_note = COALESCE($3, resolution_note),
              assigned_at = CASE WHEN $1 = 'Assigned' AND assigned_at IS NULL THEN CURRENT_TIMESTAMP ELSE assigned_at END,
              started_at = CASE WHEN $1 = 'In Progress' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
              completed_at = CASE WHEN $1 = 'Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
       WHERE repair_id = $4`,
      [status, cost, note, repairId]);

    if (status === "Completed" && repair.property_id) {
      const spent = cost == null ? 0 : cost;
      await client.query(
        "UPDATE properties SET item_condition = 'Good', status = 'In use', repair_cost_total = repair_cost_total + $1 WHERE property_id = $2",
        [spent, repair.property_id]);
      await addHistory(client, repair.property_id, { event_type: "Repaired", item_condition: "Good", note: `Repair ${repair.request_number} completed${spent ? ` (RM ${spent.toFixed(2)})` : ""}`, ref_type: "repair", ref_id: repairId, actor: req.user.name });
      await addHistory(client, repair.property_id, { event_type: "Back in use", item_condition: "Good", actor: req.user.name });
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const where = roomId(repair.room_block, repair.room_floor, repair.room_number);
  await notifyStudent(repair.student_number, { title: `Repair ${status.toLowerCase()}`, message: `Your request for the ${repair.item_name} in room ${where} is now: ${status}.`, type: "repair", page: "repairs", related_id: repairId });
  if (req.user.role === "maintenance") await notifyRoles(["warden"], { title: `Repair ${status.toLowerCase()}`, message: `${repair.item_name} in room ${where} - ${status} (by ${req.user.name}).`, type: "repair", page: "repairs", related_id: repairId });
  await audit(req, "repair_status", "repair", repairId, { status, cost });

  res.json({ message: "Repair status updated successfully.", repair: present(await load(repairId)) });
});

/* POST /api/repairs/:id/photos */
router.post("/:id/photos", requireRole("student", "warden", "administrator", "maintenance"), async (req, res) => {
  const repair = await load(int(req.params.id, "Repair"));
  if (!mayTouch(req, repair)) throw forbidden();

  const ids = await checkPhotoIds(req.body && req.body.photo_ids, { max: 6 });
  if (!ids.length) throw bad("Choose at least one photo.");

  await attachPhotos("repair", repair.repair_id, ids, req.user.id, text(req.body.caption, "Caption", { max: 200 }));
  res.status(201).json({ message: "Photos added." });
});

module.exports = router;
