const express = require("express");
const pool = require("../db");
const { bad } = require("../lib/http");
const { clean, roomId } = require("../lib/validate");
const { requireRole } = require("../lib/auth");

const router = express.Router();

/* GET /api/search?q=...  — one box that finds students, rooms, items, damage, repairs and fines */
router.get("/", requireRole("warden", "administrator", "management", "maintenance", "security"), async (req, res) => {
  const q = clean(req.query.q);
  if (q.length < 2) throw bad("Type at least 2 characters to search.");

  const like = `%${q}%`;
  const role = req.user.role;
  const groups = [];
  const add = (type, title, page, results) => { if (results.length) groups.push({ type, title, page, results }); };

  if (["warden", "administrator"].includes(role) || role === "security") {
    const r = await pool.query(
      `SELECT student_number, full_name, room_block, room_floor, room_number FROM students
       WHERE student_number LIKE $1 OR full_name LIKE $1 OR email LIKE $1 ORDER BY full_name LIMIT 6`, [like]);
    add("student", "Students", "students", r.rows.map((s) => ({ label: s.full_name, sub: `${s.student_number} · room ${roomId(s.room_block, s.room_floor, s.room_number)}`, key: s.student_number })));
  }

  if (["warden", "administrator", "management", "security"].includes(role)) {
    const rooms = await pool.query("SELECT block, floor, room_number, capacity, occupied FROM rooms ORDER BY block, floor, room_number LIMIT 400");
    const hits = rooms.rows.filter((r) => roomId(r.block, r.floor, r.room_number).toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    add("room", "Rooms", "rooms", hits.map((r) => ({ label: `Room ${roomId(r.block, r.floor, r.room_number)}`, sub: `${r.occupied}/${r.capacity} beds used`, key: roomId(r.block, r.floor, r.room_number) })));
  }

  if (["warden", "administrator", "management"].includes(role)) {
    const items = await pool.query("SELECT property_id, item_code, item_name, item_condition, room_block, room_floor, room_number FROM properties WHERE item_code LIKE $1 OR item_name LIKE $1 ORDER BY item_code LIMIT 6", [like]);
    add("item", "Items", "items", items.rows.map((i) => ({ label: `${i.item_code} · ${i.item_name}`, sub: `${i.item_condition} · room ${roomId(i.room_block, i.room_floor, i.room_number)}`, key: i.property_id })));

    const damage = await pool.query("SELECT damage_id, report_number, item_name, student_number, damage_status FROM damage_reports WHERE report_number LIKE $1 OR item_name LIKE $1 OR student_number LIKE $1 ORDER BY damage_id DESC LIMIT 6", [like]);
    add("damage", "Damage reports", "damage", damage.rows.map((d) => ({ label: `${d.report_number} · ${d.item_name}`, sub: `${d.student_number} · ${d.damage_status || "Reported"}`, key: d.damage_id })));
  }

  if (["warden", "administrator", "management", "maintenance"].includes(role)) {
    const params = [like];
    let scope = "";
    if (role === "maintenance") { params.push(req.user.id); scope = "AND assigned_user_id = $2"; }
    const repairs = await pool.query(`SELECT repair_id, request_number, item_name, repair_status FROM repair_requests WHERE (request_number LIKE $1 OR item_name LIKE $1 OR description LIKE $1) ${scope} ORDER BY repair_id DESC LIMIT 6`, params);
    add("repair", "Repairs", "repairs", repairs.rows.map((r) => ({ label: `${r.request_number} · ${r.item_name}`, sub: r.repair_status, key: r.repair_id })));
  }

  if (["warden", "administrator", "management"].includes(role)) {
    const fines = await pool.query("SELECT fine_id, fine_number, student_number, amount, status FROM fines WHERE fine_number LIKE $1 OR student_number LIKE $1 ORDER BY fine_id DESC LIMIT 6", [like]);
    add("fine", "Fines", "fines", fines.rows.map((f) => ({ label: `${f.fine_number} · RM ${Number(f.amount).toFixed(2)}`, sub: `${f.student_number} · ${f.status}`, key: f.fine_id })));
  }

  res.json({ query: q, groups });
});

module.exports = router;
