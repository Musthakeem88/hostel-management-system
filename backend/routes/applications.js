const express = require("express");
const pool = require("../db");
const { bad, notFound, forbidden, conflict, HttpError } = require("../lib/http");
const { text, roomFromBody, roomId, businessNumber, int } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyRoles, notifyStudent } = require("../lib/notify");
const { allocate, findAvailableRoom, AllocationError } = require("../lib/allocation");
const { processWaitlist, renumber } = require("../lib/waitlist");

const router = express.Router();

const COLUMNS = `application_id, application_number, student_number, full_name, email, phone, faculty,
  preferred_block, preferred_room_type, notes, status, waitlist_position, assigned_block, assigned_floor,
  assigned_number, decision_note, decided_at, created_at`;

const present = (a) => ({
  ...a,
  assigned_room: a.assigned_block ? roomId(a.assigned_block, a.assigned_floor, a.assigned_number) : null
});

async function load(id) {
  const r = await pool.query(`SELECT ${COLUMNS} FROM room_applications WHERE application_id = $1`, [id]);
  if (!r.rows.length) throw notFound("Application not found.");
  return r.rows[0];
}

/* GET /api/applications */
router.get("/", requireRole("student", "warden", "administrator"), async (req, res) => {
  const isStudent = req.user.role === "student";
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM room_applications ${isStudent ? "WHERE student_number = $1" : ""}
     ORDER BY application_id DESC LIMIT 500`,
    isStudent ? [req.user.studentNumber || ""] : []
  );
  res.json(result.rows.map(present));
});

/* POST /api/applications — a student applies for a room */
router.post("/", requireRole("student"), async (req, res) => {
  if (!req.user.studentNumber) throw bad("Your account is not linked to a student number.");

  const b = req.body || {};
  const user = (await pool.query("SELECT full_name, email, phone FROM users WHERE user_id = $1", [req.user.id])).rows[0];
  const email = text(b.email || user.email, "Email", { required: true, max: 150 });
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email address.");

  const resident = await pool.query("SELECT room_block, room_floor, room_number FROM students WHERE student_number = $1 AND (student_status IS NULL OR student_status = 'Active')", [req.user.studentNumber]);
  if (resident.rows.length) throw conflict("You already have a room.");

  const open = await pool.query("SELECT 1 FROM room_applications WHERE student_number = $1 AND status IN ('Pending', 'Waitlisted')", [req.user.studentNumber]);
  if (open.rows.length) throw conflict("You already have an application in progress.");

  const created = await pool.query(
    `INSERT INTO room_applications
       (application_number, student_number, full_name, email, phone, faculty, preferred_block, preferred_room_type, notes, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', CURRENT_TIMESTAMP)
     RETURNING ${COLUMNS}`,
    [businessNumber("APP"), req.user.studentNumber, text(b.full_name || user.full_name, "Name", { required: true, max: 120 }), email,
     text(b.phone || user.phone, "Phone", { max: 30 }), text(b.faculty, "Faculty", { max: 120 }),
     text(b.preferred_block, "Preferred hostel", { max: 10 }), text(b.preferred_room_type, "Preferred room type", { max: 30 }), text(b.notes, "Notes", { max: 500 })]
  );

  const app = created.rows[0];
  await notifyRoles(["administrator"], { title: "Room application waiting", message: `${app.full_name} (${app.student_number}) applied for a room.`, type: "application", page: "applications", related_id: app.application_id });
  await audit(req, "apply_room", "application", app.application_id);

  res.status(201).json({ message: "Application submitted. You will be notified when it is decided.", application: present(app) });
});

/* POST /api/applications/:id/approve — assign a room (automatically, or the one chosen) or waitlist if full */
router.post("/:id/approve", requireRole("administrator"), async (req, res) => {
  const app = await load(int(req.params.id, "Application"));
  if (!["Pending", "Waitlisted"].includes(app.status)) throw conflict(`This application is already ${app.status.toLowerCase()}.`);

  let room = null;
  if (req.body && req.body.room_id) {
    const r = roomFromBody({ room_id: req.body.room_id });
    room = { block: r.block, floor: r.floor, number: r.number };
  } else {
    const found = await findAvailableRoom(pool, { preferredBlock: app.preferred_block, roomType: app.preferred_room_type });
    if (found) room = { block: found.block, floor: Number(found.floor), number: Number(found.room_number) };
  }

  // nothing free: put the applicant on the waiting list
  if (!room) {
    const next = Number((await pool.query("SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS next FROM room_applications WHERE status = 'Waitlisted'")).rows[0].next);
    await pool.query("UPDATE room_applications SET status = 'Waitlisted', waitlist_position = $1, decided_by = $2, decided_at = CURRENT_TIMESTAMP, decision_note = 'No room available - placed on the waiting list' WHERE application_id = $3",
      [next, req.user.id, app.application_id]);
    await notifyStudent(app.student_number, { title: "You are on the waiting list", message: `No room is free right now. Your position is ${next}. You will be allocated automatically when a room becomes free.`, type: "application", page: "applications", related_id: app.application_id });
    await audit(req, "waitlist_application", "application", app.application_id, { position: next });
    return res.json({ message: `No room is free, so the applicant is waiting (position ${next}).`, status: "Waitlisted", waitlist_position: next });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await allocate(client, app, room, req.user.id);
    await client.query(
      `UPDATE room_applications SET status = 'Approved', waitlist_position = NULL, assigned_block = $1, assigned_floor = $2,
              assigned_number = $3, decided_by = $4, decided_at = CURRENT_TIMESTAMP, decision_note = $5 WHERE application_id = $6`,
      [room.block, room.floor, room.number, req.user.id, text(req.body && req.body.note, "Note", { max: 300 }) || "Approved", app.application_id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AllocationError) throw new HttpError(error.status, error.message);
    throw error;
  } finally {
    client.release();
  }

  await renumber();
  const where = roomId(room.block, room.floor, room.number);
  await notifyStudent(app.student_number, { title: "Room application approved", message: `You have been allocated room ${where}. Your deposit and hostel fee invoices are on the Fees page.`, type: "application", page: "myroom", related_id: app.application_id });
  await audit(req, "approve_application", "application", app.application_id, { room: where, student: app.student_number });

  res.json({ message: `Approved — room ${where} allocated.`, status: "Approved", room_id: where });
});

router.post("/:id/waitlist", requireRole("administrator"), async (req, res) => {
  const app = await load(int(req.params.id, "Application"));
  if (app.status !== "Pending") throw conflict("Only a pending application can be put on the waiting list.");

  const next = Number((await pool.query("SELECT COALESCE(MAX(waitlist_position), 0) + 1 AS next FROM room_applications WHERE status = 'Waitlisted'")).rows[0].next);
  await pool.query("UPDATE room_applications SET status = 'Waitlisted', waitlist_position = $1, decided_by = $2, decided_at = CURRENT_TIMESTAMP WHERE application_id = $3", [next, req.user.id, app.application_id]);
  await notifyStudent(app.student_number, { title: "You are on the waiting list", message: `Your position is ${next}.`, type: "application", page: "applications", related_id: app.application_id });
  await audit(req, "waitlist_application", "application", app.application_id, { position: next });
  res.json({ message: `Placed on the waiting list (position ${next}).` });
});

router.post("/:id/reject", requireRole("administrator"), async (req, res) => {
  const app = await load(int(req.params.id, "Application"));
  if (!["Pending", "Waitlisted"].includes(app.status)) throw conflict(`This application is already ${app.status.toLowerCase()}.`);
  const note = text(req.body && req.body.note, "Reason", { required: true, max: 300 });

  await pool.query("UPDATE room_applications SET status = 'Rejected', waitlist_position = NULL, decided_by = $1, decided_at = CURRENT_TIMESTAMP, decision_note = $2 WHERE application_id = $3", [req.user.id, note, app.application_id]);
  await renumber();
  await notifyStudent(app.student_number, { title: "Room application declined", message: note, type: "application", page: "applications", related_id: app.application_id });
  await audit(req, "reject_application", "application", app.application_id, { reason: note });
  res.json({ message: "Application rejected." });
});

router.post("/:id/cancel", requireRole("student"), async (req, res) => {
  const app = await load(int(req.params.id, "Application"));
  if (app.student_number !== req.user.studentNumber) throw forbidden();
  if (!["Pending", "Waitlisted"].includes(app.status)) throw conflict("This application can no longer be cancelled.");

  await pool.query("UPDATE room_applications SET status = 'Cancelled', waitlist_position = NULL WHERE application_id = $1", [app.application_id]);
  await renumber();
  await audit(req, "cancel_application", "application", app.application_id);
  res.json({ message: "Application cancelled." });
});

router.post("/process-waitlist", requireRole("administrator"), async (req, res) => {
  const result = await processWaitlist(req);
  res.json({ message: result.allocated ? `${result.allocated} waiting applicant(s) were given rooms.` : "No rooms are free for the waiting list right now.", ...result });
});

module.exports = router;
