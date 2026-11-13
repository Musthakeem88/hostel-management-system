/* Applies the SQL files in backend/migrations/ once each (tracked in schema_migrations).
   Statements are separated by a line containing only  --#
   A statement that starts with  --optional  may fail without stopping start-up
   (used for clean-up steps that depend on how the existing database was created). */
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const logger = require("./logger");

const DIR = path.join(__dirname, "..", "migrations");

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(120) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;

  for (const file of files) {
    if (done.has(file)) continue;

    const statements = fs.readFileSync(path.join(DIR, file), "utf8")
      .split(/^--#\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error) {
        if (/^--optional/i.test(statement)) {
          logger.warn("Optional migration step skipped", { file, message: error.message });
        } else {
          error.message = `Migration ${file} failed: ${error.message}`;
          throw error;
        }
      }
    }

    await pool.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    applied += 1;
    logger.info("Migration applied", { file });
  }

  return applied;
}

module.exports = { migrate };
