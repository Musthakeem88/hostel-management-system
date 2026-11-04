const express = require("express");
const pool = require("../db");
const { clean, isDate } = require("../lib/validate");
const { requireRole } = require("../lib/auth");

const router = express.Router();

router.get("/", requireRole("administrator"), async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.user) { params.push(`%${clean(req.query.user)}%`); where.push(`username LIKE $${params.length}`); }
  if (req.query.action) { params.push(`%${clean(req.query.action)}%`); where.push(`action LIKE $${params.length}`); }
  if (req.query.entity) { params.push(clean(req.query.entity)); where.push(`entity_type = $${params.length}`); }
  if (req.query.from && isDate(String(req.query.from))) { params.push(String(req.query.from)); where.push(`to_char(created_at, 'YYYY-MM-DD') >= $${params.length}`); }
  if (req.query.to && isDate(String(req.query.to))) { params.push(String(req.query.to)); where.push(`to_char(created_at, 'YYYY-MM-DD') <= $${params.length}`); }

  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const result = await pool.query(
    `SELECT log_id, username, role, action, entity_type, entity_id, details, ip, created_at
     FROM audit_logs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY log_id DESC LIMIT ${limit}`,
    params
  );
  res.json(result.rows);
});

module.exports = router;
