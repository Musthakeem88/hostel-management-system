const express = require("express");
const pool = require("../db");
const { conflict } = require("../lib/http");
const { text, oneOf } = require("../lib/validate");
const { requireRole } = require("../lib/auth");
const { audit } = require("../lib/audit");

const router = express.Router();

/* GET /api/hostels — every signed-in user (students pick a preferred hostel when applying) */
router.get("/", async (req, res) => {
  const hostels = await pool.query("SELECT hostel_id, block, name, gender, warden_user_id FROM hostels ORDER BY block");
  const stats = await pool.query(`
    SELECT block, COUNT(*) AS rooms, SUM(capacity) AS beds, SUM(occupied) AS used
    FROM rooms GROUP BY block`);

  const byBlock = new Map(stats.rows.map((r) => [String(r.block), r]));

  res.json(hostels.rows.map((h) => {
    const s = byBlock.get(String(h.block)) || {};
    const beds = Number(s.beds || 0);
    const used = Number(s.used || 0);
    return { ...h, rooms: Number(s.rooms || 0), beds, used, available_beds: beds - used };
  }));
});

router.post("/", requireRole("administrator"), async (req, res) => {
  const b = req.body || {};
  const block = text(b.block, "Block code", { required: true, max: 10 });
  const name = text(b.name, "Hostel name", { required: true, max: 100 });
  const gender = b.gender ? oneOf(b.gender, ["Male", "Female", "Mixed"], "Gender") : null;

  const exists = await pool.query("SELECT 1 FROM hostels WHERE block = $1", [block]);
  if (exists.rows.length) throw conflict("A hostel with that block code already exists.");

  await pool.query("INSERT INTO hostels (block, name, gender, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)", [block, name, gender]);
  await audit(req, "create_hostel", "hostel", block, { name });
  res.status(201).json({ message: "Hostel added." });
});

module.exports = router;
