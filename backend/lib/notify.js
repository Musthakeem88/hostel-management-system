/* In-system notifications. Never throws. Call AFTER a database transaction has been released. */
const pool = require("../db");
const logger = require("./logger");

async function notifyUsers(userIds, { title, message, type, page, related_id, dedupe_key }) {
  const ids = Array.from(new Set((userIds || []).filter((id) => id != null)));

  for (const userId of ids) {
    try {
      if (dedupe_key) {
        const exists = await pool.query(
          "SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe_key = $2",
          [userId, dedupe_key]
        );
        if (exists.rows.length) continue;
      }

      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, page, related_id, dedupe_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [userId, String(title).slice(0, 150), message || null, type || null, page || null, related_id ?? null, dedupe_key || null]
      );
    } catch (error) {
      logger.warn("Could not create notification", { message: error.message });
    }
  }
}

async function notifyRoles(roles, payload) {
  try {
    const marks = roles.map((_, i) => `$${i + 1}`).join(", ");
    const result = await pool.query(
      `SELECT user_id FROM users WHERE status = 'Active' AND role IN (${marks})`,
      roles
    );
    await notifyUsers(result.rows.map((r) => r.user_id), payload);
  } catch (error) {
    logger.warn("Could not notify roles", { message: error.message });
  }
}

async function notifyStudent(studentNumber, payload) {
  if (!studentNumber) return;
  try {
    const result = await pool.query(
      "SELECT user_id FROM users WHERE status = 'Active' AND student_number = $1",
      [studentNumber]
    );
    await notifyUsers(result.rows.map((r) => r.user_id), payload);
  } catch (error) {
    logger.warn("Could not notify student", { message: error.message });
  }
}

module.exports = { notifyUsers, notifyRoles, notifyStudent };
