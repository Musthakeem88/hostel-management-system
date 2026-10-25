
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


/* GET: Load registered students */
app.get("/api/students", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        student_id,
        student_number,
        full_name,
        email,
        phone,
        room_block,
        room_floor,
        room_number,
        created_at
      FROM public.students
      ORDER BY student_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load students error:", error.message);
    res.status(500).json({ error: "Could not load students." });
  }
});

/* POST: Register a student and assign a room */
app.post("/api/students", async (req, res) => {
  const {
    student_number,
    full_name,
    email,
    phone,
    room_block,
    room_floor,
    room_number
  } = req.body;

  if (
    !student_number?.trim() ||
    !full_name?.trim() ||
    !email?.trim() ||
    !room_block ||
    room_floor == null ||
    room_number == null
  ) {
    return res.status(400).json({
      error: "Complete all required fields and select a room."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const roomResult = await client.query(
      `SELECT capacity, occupied, under_maintenance
       FROM public.rooms
       WHERE block = $1 AND floor = $2 AND room_number = $3
       FOR UPDATE`,
      [room_block, room_floor, room_number]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Room not found." });
    }

    const room = roomResult.rows[0];

    if (room.under_maintenance === true) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "This room is under maintenance."
      });
    }

    if (Number(room.occupied) >= Number(room.capacity)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "This room is full." });
    }

    const result = await client.query(
      `INSERT INTO public.students
       (student_number, full_name, email, phone,
        room_block, room_floor, room_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        student_number.trim(),
        full_name.trim(),
        email.trim(),
        phone?.trim() || null,
        room_block,
        Number(room_floor),
        Number(room_number)
      ]
    );

    await client.query(
      `UPDATE public.rooms
       SET occupied = occupied + 1
       WHERE block = $1 AND floor = $2 AND room_number = $3`,
      [room_block, room_floor, room_number]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Student registered successfully.",
      student: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Register student error:", error.message);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Student number or email is already registered."
      });
    }

    res.status(500).json({ error: "Could not register student." });
  } finally {
    client.release();
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
