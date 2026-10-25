const express = require("express");
require("dotenv").config();

const pool = require("./db");
const app = express();

app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ message: "Server and database connected!" });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({
      error: "Database connection failed.",
      details: error.message
    });
  }
});

app.get("/api/rooms", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        block,
        floor,
        room_number,
        capacity,
        occupied,
        under_maintenance
      FROM rooms
      ORDER BY block, floor, room_number
    `);

    const rooms = result.rows.map((room) => ({
      ...room,
      room_id: `${room.block}-${String(room.floor).padStart(2, "0")}-${String(room.room_number).padStart(2, "0")}`,
    }));

    res.json(rooms);
  } catch (error) {
    console.error("Rooms error:", error);
res.status(500).json({
      error: "Could not retrieve rooms.",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Hostel backend running at http://localhost:${PORT}`);
});