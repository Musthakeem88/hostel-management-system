const express = require("express");
const pool = require("../db");
const { bad, notFound, HttpError, conflict } = require("../lib/http");
const { text, roomFromBody, clean, roomId } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");
const { notifyStudent } = require("../lib/notify");
const { allocate, vacate, AllocationError } = require("../lib/allocation");
const { depositSummary } = require("../lib/billing");
const { processWaitlist } = require("../lib/waitlist");
const { fileUrl } = require("../lib/storage");

const router = express.Router();

const LIST_COLUMNS = `student_id, student_number, full_name, email, phone, room_block, room_floor, room_number,
  faculty, hostel, emergency_contact_name, emergency_contact_phone, student_status, check_in_date, check_out_date, created_at`;

/* GET /api/students */
router.get("/", requireRole("warden", "administrator"), async (req, res) => {
  const result = await pool.query(`SELECT ${LIST_COLUMNS} FROM public.students ORDER BY student_id DESC`);
  res.json(result.rows);
});

/* GET /api/students/lookup?q=  — small search used by forms (name, number, room) */
router.get("/lookup", requireRole("warden", "administrator", "security"), async (req, res) => {
  const q = `%${clean(req.query.q)}%`;
  const result = await pool.query(
    `SELECT student_number, full_name, phone, room_block, room_floor, room_number
     FROM students
     WHERE (student_status IS NULL OR student_status = 'Active')
       AND (student_number LIKE $1 OR full_name LIKE $1)
     ORDER BY full_name LIMIT 20`,
    [q]
  );
  res.json(result.rows.map((s) => ({ ...s, room_id: roomId(s.room_block, s.room_floor, s.room_number) })));
});

/* GET /api/students/:number — full profile for staff */
router.get("/:number", requireRole("warden", "administrator"), async (req, res) => {
  const found = await pool.query(`SELECT ${LIST_COLUMNS} FROM students WHERE student_number = $1`, [req.params.number]);
  if (!found.rows.length) throw notFound("Student not found.");

  const docs = await pool.query(
    "SELECT doc_id, doc_type, file_id, note, created_at FROM student_documents WHERE student_number = $1 ORDER BY doc_id DESC",
    [req.params.number]
  );
  const deposit = await depositSummary(pool, req.params.number);

  res.json({
    student: found.rows[0],
    documents: docs.rows.map((d) => ({ ...d, url: fileUrl(d.file_id) })),
    deposit
  });
});

/* POST /api/students — register a student in a room */
router.post("/", requireRole("warden", "administrator"), async (req, res) => {
  const b = req.body || {};

  if (
    typeof b.student_number !== "string" || !b.student_number.trim() ||
    typeof b.full_name !== "string" || !b.full_name.trim() ||
    typeof b.email !== "string" || !b.email.trim() ||
    !b.room_block || b.room_floor == null || b.room_number == null
  ) {
    return res.status(400).json({ error: "Complete all required fields and select a room." });
  }

  const room = roomFromBody(b);
  const student = {
    student_number: b.student_number.trim(),
    full_name: b.full_name.trim(),
    email: b.email.trim(),
    phone: b.phone ? String(b.phone).trim() : null,
    faculty: text(b.faculty, "Faculty", { max: 120 }),
    emergency_contact_name: text(b.emergency_contact_name, "Emergency contact name", { max: 120 }),
    emergency_contact_phone: text(b.emergency_contact_phone, "Emergency contact phone", { max: 30 })
  };

  const client = await pool.connect();
  let row;

  try {
    await client.query("BEGIN");
    row = await allocate(client, student, room, req.user.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AllocationError) throw new HttpError(error.status, error.message);
    if (error.code === "23505") throw conflict("Student number or email is already registered.");
    throw error;
  } finally {
    client.release();
  }

  await audit(req, "register_student", "student", row.student_number, { room: roomId(room.block, room.floor, room.number) });
  await notifyStudent(row.student_number, { title: "Room allocated", message: `You have been allocated room ${roomId(room.block, room.floor, room.number)}.`, type: "room", page: "myroom" });

  res.status(201).json({ message: "Student registered successfully.", student: row });
});

/* PUT /api/students/:number — update contact / faculty / emergency contact */
router.put("/:number", requireRole("warden", "administrator"), async (req, res) => {
  const b = req.body || {};
  const found = await pool.query("SELECT student_number FROM students WHERE student_number = $1", [req.params.number]);
  if (!found.rows.length) throw notFound("Student not found.");

  const email = text(b.email, "Email", { required: true, max: 150 });
  if (!/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email address.");

  await pool.query(
    `UPDATE students SET full_name = $1, email = $2, phone = $3, faculty = $4,
            emergency_contact_name = $5, emergency_contact_phone = $6 WHERE student_number = $7`,
    [text(b.full_name, "Full name", { required: true, max: 120 }), email, text(b.phone, "Phone", { max: 30 }),
     text(b.faculty, "Faculty", { max: 120 }), text(b.emergency_contact_name, "Emergency contact", { max: 120 }),
     text(b.emergency_contact_phone, "Emergency phone", { max: 30 }), req.params.number]
  );
  await audit(req, "update_student", "student", req.params.number);
  res.json({ message: "Student updated." });
});

/* POST /api/students/:number/documents — staff attach a document */
router.post("/:number/documents", requireRole("warden", "administrator"), async (req, res) => {
  const found = await pool.query("SELECT 1 FROM students WHERE student_number = $1", [req.params.number]);
  if (!found.rows.length) throw notFound("Student not found.");

  const { doc_type, file_id, note } = req.body || {};
  const file = await pool.query("SELECT 1 FROM files WHERE file_id = $1", [clean(file_id)]);
  if (!file.rows.length) throw bad("Upload the document first.");

  await pool.query(
    "INSERT INTO student_documents (student_number, doc_type, file_id, note, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)",
    [req.params.number, text(doc_type, "Document type", { required: true, max: 40 }), clean(file_id), text(note, "Note", { max: 200 }), req.user.id]
  );
  await audit(req, "add_document", "student", req.params.number, { doc_type });
  res.status(201).json({ message: "Document added." });
});

/* POST /api/students/:number/checkout — student leaves the hostel */
router.post("/:number/checkout", requireRole("warden", "administrator"), async (req, res) => {
  const found = await pool.query("SELECT * FROM students WHERE student_number = $1", [req.params.number]);
  if (!found.rows.length) throw notFound("Student not found.");

  const student = found.rows[0];
  if (student.student_status && student.student_status !== "Active") throw bad("This student has already checked out.");

  const inspected = await pool.query(
    "SELECT 1 FROM inspections WHERE student_number = $1 AND inspection_type = 'Check-out'", [student.student_number]);

  if (!inspected.rows.length && !(req.body && req.body.force)) {
    throw new HttpError(409, "No check-out inspection has been recorded for this student. Inspect the room first, or confirm to check out without one.", { needsConfirmation: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await vacate(client, student);
    await client.query(
      "UPDATE students SET student_status = 'Checked out', check_out_date = CURRENT_DATE WHERE student_number = $1", [student.student_number]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const deposit = await depositSummary(pool, student.student_number);
  const refundable = Math.max(0, Math.round((deposit.balance - deposit.unpaid_fines) * 100) / 100);

  await audit(req, "checkout_student", "student", student.student_number, { room: roomId(student.room_block, student.room_floor, student.room_number) });
  await notifyStudent(student.student_number, { title: "Check-out complete", message: "Your check-out has been recorded. Your deposit will be settled by the hostel office.", type: "room", page: "fees" });

  const waitlist = await processWaitlist(req);

  res.json({
    message: "Student checked out. The room is now free.",
    settlement: { ...deposit, refundable },
    waitlist_allocated: waitlist.allocated
  });
});

module.exports = router;
