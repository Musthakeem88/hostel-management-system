/* Central configuration — everything comes from environment variables (.env). */
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const env = process.env;

module.exports = {
  port: Number(env.PORT) || 3000,
  isProduction: env.NODE_ENV === "production",

  // Secret used to sign login tokens. Set JWT_SECRET in .env so logins survive a restart.
  jwtSecret: env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtSecretIsGenerated: !env.JWT_SECRET,
  tokenHours: Number(env.TOKEN_HOURS) || 12,

  // First administrator, created automatically when the users table is empty.
  adminUsername: env.ADMIN_USERNAME || "admin",
  adminPassword: env.ADMIN_PASSWORD || "Admin@12345",
  adminName: env.ADMIN_NAME || "System Administrator",

  allowStudentSignup: env.ALLOW_STUDENT_SIGNUP !== "false",

  // Photo / document storage: "local" (folder) or "s3" (AWS S3, needs @aws-sdk/client-s3)
  storageDriver: env.STORAGE_DRIVER || "local",
  uploadDir: env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads"),
  maxFileBytes: (Number(env.MAX_FILE_MB) || 6) * 1024 * 1024,
  s3Bucket: env.S3_BUCKET || "",
  s3Region: env.AWS_REGION || "ap-southeast-1",

  logLevel: env.LOG_LEVEL || "info",
  metricsToken: env.METRICS_TOKEN || "",
  schedulerEnabled: env.SCHEDULER !== "off"
};
