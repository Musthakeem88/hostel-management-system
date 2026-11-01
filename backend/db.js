require("dotenv").config();
const { Pool, types } = require("pg");

/* Make PostgreSQL values arrive in the shapes the rest of the code expects:
   - DATE        -> "YYYY-MM-DD" text (not a JS Date, which shifts the day with the server time zone)
   - TIMESTAMPTZ -> ISO text such as "2026-11-01T02:30:00.000Z"
   - NUMERIC / BIGINT (money, COUNT, SUM) -> JS numbers instead of strings */
types.setTypeParser(1082, (value) => value);                                        // DATE
const parseTimestamptz = types.getTypeParser(1184);                                 // pg's own parser
types.setTypeParser(1184, (value) => {                                              // TIMESTAMPTZ
  const parsed = parseTimestamptz(value);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : parsed;
});
types.setTypeParser(1700, (value) => parseFloat(value));                            // NUMERIC
types.setTypeParser(20, (value) => parseInt(value, 10));                            // BIGINT / COUNT(*)

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// An idle-client error must not crash the whole server
pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});

module.exports = pool;
