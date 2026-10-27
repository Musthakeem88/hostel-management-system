const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
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
    console.error("Load students error:", error);

    res.status(500).json({
      error: "Could not load students."
    });
  }
});

router.post("/", async (req, res) => {
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
    typeof student_number !== "string" ||
    !student_number.trim() ||
    typeof full_name !== "string" ||
    !full_name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
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
       WHERE block = $1
         AND floor = $2
         AND room_number = $3
       FOR UPDATE`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    if (roomResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Room not found."
      });
    }

    const room = roomResult.rows[0];

    if (room.under_maintenance) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "This room is under maintenance."
      });
    }

    if (Number(room.occupied) >= Number(room.capacity)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "This room is full."
      });
    }

    const result = await client.query(
      `INSERT INTO public.students
       (
         student_number,
         full_name,
         email,
         phone,
         room_block,
         room_floor,
         room_number
       )
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
       WHERE block = $1
         AND floor = $2
         AND room_number = $3`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Student registered successfully.",
      student: result.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Register student error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Student number or email is already registered."
      });
    }

    res.status(500).json({
      error: "Could not register student."
    });
  } finally {
    client.release();
  }
});

module.exports = router;
