const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.damage_reports
      ORDER BY created_at DESC, damage_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load damage reports error:", error);

    res.status(500).json({
      error: "Could not load damage reports."
    });
  }
});

router.post("/", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    item_name,
    student_number,
    description,
    fine_amount
  } = req.body;

  const amount = Number(fine_amount);

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof item_name !== "string" ||
    !item_name.trim() ||
    typeof student_number !== "string" ||
    !student_number.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    fine_amount == null ||
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    return res.status(400).json({
      error: "Please provide valid damage report details and fine amount."
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

    // Keep the generated ID below the VARCHAR(20) limit.
    const reportNumber =
      "DMG-" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 10).toString();

    const result = await pool.query(
      `INSERT INTO public.damage_reports
       (
         report_number,
         room_block,
         room_floor,
         room_number,
         item_name,
         student_number,
         description,
         fine_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        reportNumber,
        room_block,
        Number(room_floor),
        Number(room_number),
        item_name.trim(),
        student_number.trim(),
        description.trim(),
        amount
      ]
    );

    res.status(201).json({
      message: "Damage report created successfully.",
      damage: result.rows[0]
    });
  } catch (error) {
    console.error("Create damage report error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Duplicate report number. Please try again."
      });
    }

    res.status(500).json({
      error: "Could not create damage report."
    });
  }
});

router.patch("/:id/status", async (req, res) => {
  const status = String(req.body?.status ?? "").trim();
  const disputeReason = req.body?.dispute_reason;
  const damageId = Number(req.params.id);

  const allowedStatuses = [
    "Pending",
    "Under Review",
    "Approved",
    "Paid"
  ];

  if (!Number.isInteger(damageId) || damageId <= 0) {
    return res.status(400).json({
      error: "Invalid damage report ID."
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Invalid fine status: "${status}".`,
      received: req.body?.status ?? null,
      allowedStatuses
    });
  }

  try {
    const result = await pool.query(
      `UPDATE public.damage_reports
       SET fine_status = $1,
           dispute_reason = CASE
             WHEN $2::text IS NULL THEN dispute_reason
             ELSE $2
           END
       WHERE damage_id = $3
       RETURNING *`,
      [
        status,
        disputeReason == null ? null : String(disputeReason),
        damageId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Damage report not found."
      });
    }

    return res.json({
      message: "Fine status updated successfully.",
      damage: result.rows[0]
    });
  } catch (error) {
    console.error("Update fine status error:", error);

    return res.status(500).json({
      error: "Could not update fine status."
    });
  }
});

module.exports = router;
