
const express = require("express");
const path = require("path");
require("dotenv").config();

const pool = require("./db");
const app = express();

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve the frontend files
// Main/index.html, CSS/style.css, and JS/script.js
app.use(express.static(path.join(__dirname, "..")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../Main/index.html"));
});

// Check server and database connection
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "Server and database connected!"
    });
  } catch (error) {
    console.error("Database error:", error.message);

    res.status(500).json({
      success: false,
      error: "Database connection failed."
    });
  }
});

// Get rooms from PostgreSQL
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
      FROM public.rooms
      ORDER BY block, floor, room_number
    `);

    const rooms = result.rows.map((room) => ({
      ...room,
      room_id: `${room.block}-${String(room.floor).padStart(2, "0")}-${String(room.room_number).padStart(2, "0")}`
    }));

    res.json(rooms);
  } catch (error) {
    console.error("Rooms error:", error.message);

    res.status(500).json({
      success: false,
      error: "Could not retrieve rooms."
    });
  }
});

// Handle unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found."
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Hostel Management System running at http://localhost:${PORT}`);
});
