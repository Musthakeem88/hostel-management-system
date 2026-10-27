const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.inspections
      ORDER BY inspection_date DESC, inspection_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load inspections error:", error);

    res.status(500).json({
      error: "Could not load inspections."
    });
  }
});

router.post("/", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    student_number,
    inspection_type,
    inspection_items
  } = req.body;

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof student_number !== "string" ||
    !student_number.trim() ||
    !["Check-in", "Check-out"].includes(inspection_type) ||
    !Array.isArray(inspection_items)
  ) {
    return res.status(400).json({
      error: "Please provide all required inspection details."
    });
  }

  try {
    const studentResult = await pool.query(
      `SELECT student_id
       FROM public.students
       WHERE student_number = $1
         AND room_block = $2
         AND room_floor = $3
         AND room_number = $4`,
      [
        student_number.trim(),
        room_block,
        Number(room_floor),
        Number(room_number)
      ]
    );

    if (studentResult.rows.length === 0) {
      return res.status(400).json({
        error: "The student is not assigned to the selected room."
      });
    }

    const result = await pool.query(
      `INSERT INTO public.inspections
       (
         room_block,
         room_floor,
         room_number,
         student_number,
         inspection_type,
         inspection_items
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        room_block,
        Number(room_floor),
        Number(room_number),
        student_number.trim(),
        inspection_type,
        JSON.stringify(inspection_items)
      ]
    );

    res.status(201).json({
      message: "Inspection saved successfully.",
      inspection: result.rows[0]
    });
  } catch (error) {
    console.error("Save inspection error:", error);

    res.status(500).json({
      error: "Could not save inspection."
    });
  }
});

module.exports = router;
