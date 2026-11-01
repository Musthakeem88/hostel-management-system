const express = require("express");
const pool = require("../db");
const { bad, notFound } = require("../lib/http");
const { text, clean, roomId } = require("../lib/validate");
const { audit } = require("../lib/audit");
const { fileUrl } = require("../lib/storage");
const { depositSummary } = require("../lib/billing");

const router = express.Router();

async function load(req) {
  const user = (await pool.query("SELECT user_id, username, full_name, email, phone, role, student_number FROM users WHERE user_id = $1", [req.user.id])).rows[0];
  let student = null;
  let documents = [];
  let deposit = null;

  if (user.student_number) {
    student = (await pool.query(
      `SELECT student_number, full_name, email, phone, faculty, room_block, room_floor, room_number, hostel,
              emergency_contact_name, emergency_contact_phone, student_status, check_in_date, check_out_date
       FROM students WHERE student_number = $1`, [user.student_number])).rows[0] || null;

    documents = (await pool.query(
      "SELECT doc_id, doc_type, file_id, note, created_at FROM student_documents WHERE student_number = $1 ORDER BY doc_id DESC",
      [user.student_number])).rows.map((d) => ({ ...d, url: fileUrl(d.file_id) }));

    deposit = await depositSummary(pool, user.student_number);
  }

  return {
    user,
    student: student && { ...student, room_id: roomId(student.room_block, student.room_floor, student.room_number) },
    documents,
    deposit
  };
}

/* GET /api/profile */
router.get("/", async (req, res) => {
  res.json(await load(req));
});

/* GET /api/profile/room — my room and the university items in it (students) */
router.get("/room", async (req, res) => {
  if (!req.user.studentNumber) return res.json({ room: null, items: [] });

  const s = (await pool.query(
    "SELECT room_block, room_floor, room_number, student_status FROM students WHERE student_number = $1", [req.user.studentNumber])).rows[0];
  if (!s) return res.json({ room: null, items: [] });

  const where = [s.room_block, s.room_floor, s.room_number];
  const room = (await pool.query("SELECT capacity, occupied, room_type FROM rooms WHERE block = $1 AND floor = $2 AND room_number = $3", where)).rows[0] || {};
  const items = (await pool.query(
    `SELECT property_id, item_code, item_name, item_condition, status FROM properties
     WHERE room_block = $1 AND room_floor = $2 AND room_number = $3 AND status IN ('In use', 'Under repair')
     ORDER BY item_name, item_code`, where)).rows;

  res.json({
    room: {
      room_id: roomId(s.room_block, s.room_floor, s.room_number),
      hostel: s.room_block,
      room_type: room.room_type || "Standard",
      capacity: Number(room.capacity || 0),
      occupied: Number(room.occupied || 0),
      resident: !s.student_status || s.student_status === "Active"
    },
    items
  });
});

/* PUT /api/profile — update my own contact details */
router.put("/", async (req, res) => {
  const b = req.body || {};
  const email = text(b.email, "Email", { max: 150 });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad("Enter a valid email address.");

  await pool.query("UPDATE users SET full_name = $1, email = $2, phone = $3 WHERE user_id = $4",
    [text(b.full_name, "Full name", { required: true, max: 120 }), email, text(b.phone, "Phone", { max: 30 }), req.user.id]);

  if (req.user.studentNumber) {
    await pool.query(
      `UPDATE students SET phone = $1, email = COALESCE($2, email), faculty = $3,
              emergency_contact_name = $4, emergency_contact_phone = $5 WHERE student_number = $6`,
      [text(b.phone, "Phone", { max: 30 }), email, text(b.faculty, "Faculty", { max: 120 }),
       text(b.emergency_contact_name, "Emergency contact", { max: 120 }),
       text(b.emergency_contact_phone, "Emergency phone", { max: 30 }), req.user.studentNumber]
    );
  }

  await audit(req, "update_profile", "user", req.user.id);
  res.json({ message: "Profile updated." });
});

/* POST /api/profile/documents — students add their own documents */
router.post("/documents", async (req, res) => {
  if (!req.user.studentNumber) throw bad("Only students have documents.");

  const { doc_type, file_id, note } = req.body || {};
  const file = await pool.query("SELECT 1 FROM files WHERE file_id = $1 AND uploaded_by = $2", [clean(file_id), req.user.id]);
  if (!file.rows.length) throw bad("Upload the document first.");

  await pool.query(
    "INSERT INTO student_documents (student_number, doc_type, file_id, note, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)",
    [req.user.studentNumber, text(doc_type, "Document type", { required: true, max: 40 }), clean(file_id), text(note, "Note", { max: 200 }), req.user.id]
  );
  await audit(req, "add_document", "student", req.user.studentNumber, { doc_type });
  res.status(201).json({ message: "Document added." });
});

router.delete("/documents/:id", async (req, res) => {
  const result = await pool.query("DELETE FROM student_documents WHERE doc_id = $1 AND student_number = $2", [Number(req.params.id), req.user.studentNumber]);
  if (!result.rowCount) throw notFound("Document not found.");
  res.json({ message: "Document removed." });
});

module.exports = router;
