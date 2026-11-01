const pool = require("../db");

async function getSetting(key, fallback = null, db = pool) {
  const r = await db.query("SELECT setting_value FROM settings WHERE setting_key = $1", [key]);
  return r.rows.length && r.rows[0].setting_value != null ? r.rows[0].setting_value : fallback;
}

async function getNumberSetting(key, fallback = 0, db = pool) {
  const n = Number(await getSetting(key, fallback, db));
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { getSetting, getNumberSetting };
