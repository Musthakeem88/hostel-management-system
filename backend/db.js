require("dotenv").config();

// DB_DRIVER=sqlite is only for automated tests / quick demos (see test-support/).
// Normal use: PostgreSQL via the DB_* settings in .env.
if (process.env.DB_DRIVER === "sqlite") {
  module.exports = require("./test-support/sqlite-pool").getPool();
} else {
  const { Pool } = require("pg");

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
}
