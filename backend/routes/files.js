const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const config = require("../lib/config");
const storage = require("../lib/storage");
const { bad, notFound } = require("../lib/http");
const { authenticate } = require("../lib/auth");

// Upload: POST /api/files  { data: "<base64 or data URL>", name, purpose }
const uploadRouter = express.Router();

uploadRouter.post("/", express.json({ limit: "10mb" }), authenticate, async (req, res) => {
  const { data, name, purpose } = req.body || {};

  if (typeof data !== "string" || !data) throw bad("No file was received.");

  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length === 0) throw bad("The file is empty.");
  if (buffer.length > config.maxFileBytes) {
    throw bad(`The file is too large (max ${Math.round(config.maxFileBytes / 1048576)} MB).`);
  }

  const mime = storage.detectMime(buffer);
  const allowDocuments = purpose === "document";

  if (!mime || (mime === "application/pdf" && !allowDocuments)) {
    throw bad(allowDocuments ? "Only JPG, PNG, WEBP photos or PDF documents are allowed."
                             : "Only JPG, PNG or WEBP photos are allowed.");
  }

  const fileId = crypto.randomUUID();
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${fileId}.${storage.EXTENSIONS[mime]}`;
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  await storage.getDriver().save(key, buffer, mime);

  await pool.query(
    `INSERT INTO files (file_id, storage_key, mime, size_bytes, original_name, sha256, purpose, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
    [fileId, key, mime, buffer.length, String(name || "").slice(0, 150) || null, sha256, String(purpose || "photo").slice(0, 30), req.user.id]
  );

  res.status(201).json({ id: fileId, url: storage.fileUrl(fileId), mime, size: buffer.length });
});

// Download: GET /api/files/:id?exp=...&sig=...   (signed link, so <img> tags work)
const downloadRouter = express.Router();

downloadRouter.get("/:id", async (req, res) => {
  const { exp, sig } = req.query;

  if (!storage.verifySignedUrl(req.params.id, exp, sig)) {
    return res.status(403).json({ error: "This file link is invalid or has expired." });
  }

  const result = await pool.query("SELECT storage_key, mime, original_name FROM files WHERE file_id = $1", [req.params.id]);
  if (!result.rows.length) throw notFound("File not found.");

  const file = result.rows[0];
  const buffer = await storage.getDriver().read(file.storage_key);

  res.set({
    "Content-Type": file.mime,
    "Content-Length": buffer.length,
    "Cache-Control": "private, max-age=3000",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
  });
  res.send(buffer);
});

module.exports = { uploadRouter, downloadRouter };
