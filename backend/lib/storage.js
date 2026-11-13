/* File storage for photos and documents.
   local : files in the uploads/ folder (default)
   s3    : AWS S3 bucket (install the optional package:  npm install @aws-sdk/client-s3)
   Files are always served through short-lived signed links, so they stay private. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

/* ---------- drivers ---------- */

const local = {
  async save(key, buffer) {
    const target = path.join(config.uploadDir, key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, buffer);
  },
  async read(key) {
    const target = path.join(config.uploadDir, key);
    if (!path.resolve(target).startsWith(path.resolve(config.uploadDir))) throw new Error("Bad key");
    return fs.promises.readFile(target);
  },
  async remove(key) {
    await fs.promises.rm(path.join(config.uploadDir, key), { force: true });
  }
};

function s3Driver() {
  const sdk = require("@aws-sdk/client-s3"); // optional dependency
  const client = new sdk.S3Client({ region: config.s3Region });
  const Bucket = config.s3Bucket;

  return {
    async save(key, buffer, mime) {
      await client.send(new sdk.PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: mime, ServerSideEncryption: "AES256" }));
    },
    async read(key) {
      const out = await client.send(new sdk.GetObjectCommand({ Bucket, Key: key }));
      const chunks = [];
      for await (const chunk of out.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    },
    async remove(key) {
      await client.send(new sdk.DeleteObjectCommand({ Bucket, Key: key }));
    }
  };
}

let driver = null;

function getDriver() {
  if (!driver) driver = config.storageDriver === "s3" ? s3Driver() : local;
  return driver;
}

/* ---------- signed links ---------- */

function signature(fileId, expires) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`${fileId}.${expires}`).digest("base64url");
}

function fileUrl(fileId, ttlSeconds = 3600) {
  if (!fileId) return null;
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${encodeURIComponent(fileId)}?exp=${expires}&sig=${signature(fileId, expires)}`;
}

function verifySignedUrl(fileId, expires, sig) {
  if (!fileId || !expires || !sig) return false;
  if (Number(expires) < Date.now() / 1000) return false;
  const expected = Buffer.from(signature(fileId, expires));
  const actual = Buffer.from(String(sig));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------- file type detection (never trust the upload's own label) ---------- */

function detectMime(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length > 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.length > 5 && buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

module.exports = { getDriver, fileUrl, verifySignedUrl, detectMime, EXTENSIONS };
