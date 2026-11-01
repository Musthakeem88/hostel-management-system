/* Helpers for turning stored file ids into signed links, and checking ids sent by the browser. */
const pool = require("../db");
const { bad } = require("./http");
const { fileUrl } = require("./storage");
const { parseJson } = require("./validate");

// Makes sure every id exists in the files table (and is an image)
async function checkPhotoIds(ids, { max = 8, label = "photos" } = {}) {
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id))));
  if (list.length > max) throw bad(`You can attach at most ${max} ${label}.`);
  if (!list.length) return [];

  const marks = list.map((_, i) => `$${i + 1}`).join(", ");
  const found = await pool.query(`SELECT file_id, mime FROM files WHERE file_id IN (${marks})`, list);
  if (found.rows.length !== list.length) throw bad("One of the photos was not uploaded correctly. Please upload it again.");
  if (found.rows.some((r) => !String(r.mime).startsWith("image/"))) throw bad("Only photos can be attached here.");
  return list;
}

const refs = (ids) => (ids || []).map((id) => ({ id, url: fileUrl(id) }));
const refsFromJson = (value) => refs(parseJson(value, []));

async function entityPhotos(type, id) {
  const r = await pool.query("SELECT file_id, caption FROM entity_files WHERE entity_type = $1 AND entity_id = $2 ORDER BY ef_id", [type, id]);
  return r.rows.map((p) => ({ id: p.file_id, url: fileUrl(p.file_id), caption: p.caption }));
}

async function attachPhotos(type, id, fileIds, userId, caption) {
  for (const fileId of fileIds) {
    await pool.query(
      "INSERT INTO entity_files (entity_type, entity_id, file_id, caption, uploaded_by, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)",
      [type, id, fileId, caption || null, userId ?? null]
    );
  }
}

module.exports = { checkPhotoIds, refs, refsFromJson, entityPhotos, attachPhotos };
