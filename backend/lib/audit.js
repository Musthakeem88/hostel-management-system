/* Activity log for important actions (damage, fines, payments, users...).
   Never throws. Call it AFTER a database transaction has been released. */
const pool = require("../db");
const logger = require("./logger");

async function audit(req, action, entityType, entityId, details) {
  try {
    const user = (req && req.user) || {};

    await pool.query(
      `INSERT INTO audit_logs (user_id, username, role, action, entity_type, entity_id, details, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      [
        user.id ?? null,
        user.username ?? null,
        user.role ?? null,
        action,
        entityType ?? null,
        entityId == null ? null : String(entityId),
        details == null ? null : (typeof details === "string" ? details : JSON.stringify(details)).slice(0, 2000),
        req && req.ip ? String(req.ip).slice(0, 60) : null
      ]
    );
  } catch (error) {
    logger.warn("Could not write audit log", { action, message: error.message });
  }
}

module.exports = { audit };
