const express = require("express");
const pool = require("../db");
const { notFound } = require("../lib/http");

const router = express.Router();

router.get("/", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const result = await pool.query(
    `SELECT notification_id, title, message, type, page, related_id, read_at, created_at
     FROM notifications WHERE user_id = $1 ${req.query.unread ? "AND read_at IS NULL" : ""}
     ORDER BY notification_id DESC LIMIT ${limit}`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.get("/count", async (req, res) => {
  const r = await pool.query("SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ unread: Number(r.rows[0].total) });
});

router.post("/read-all", async (req, res) => {
  await pool.query("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND read_at IS NULL", [req.user.id]);
  res.json({ message: "All notifications marked as read." });
});

router.post("/:id/read", async (req, res) => {
  const r = await pool.query("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE notification_id = $1 AND user_id = $2 AND read_at IS NULL", [Number(req.params.id), req.user.id]);
  if (!r.rowCount) {
    const exists = await pool.query("SELECT 1 FROM notifications WHERE notification_id = $1 AND user_id = $2", [Number(req.params.id), req.user.id]);
    if (!exists.rows.length) throw notFound("Notification not found.");
  }
  res.json({ message: "Marked as read." });
});

module.exports = router;
