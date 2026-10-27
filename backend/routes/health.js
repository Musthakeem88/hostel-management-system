const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "Server and database connected!"
    });
  } catch (error) {
    console.error("Database health check error:", error);

    res.status(500).json({
      success: false,
      error: "Database connection failed."
    });
  }
});

module.exports = router;
