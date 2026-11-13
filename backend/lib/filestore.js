/* Saves a file the server made itself (e.g. the monthly PDF) the same way uploads are saved. */
const crypto = require("crypto");
const pool = require("../db");
const storage = require("./storage");

async function storeBuffer(buffer, { mime, name, purpose, userId = null }) {
  const id = crypto.randomUUID();
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${storage.EXTENSIONS[mime] || "bin"}`;

  await storage.getDriver().save(key, buffer, mime);
  await pool.query(
    `INSERT INTO files (file_id, storage_key, mime, size_bytes, original_name, sha256, purpose, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
    [id, key, mime, buffer.length, name, crypto.createHash("sha256").update(buffer).digest("hex"), purpose, userId]
  );
  return id;
}

module.exports = { storeBuffer };
