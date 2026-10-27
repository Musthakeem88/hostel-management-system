const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM public.repair_requests
      ORDER BY created_at DESC, repair_id DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Load repairs error:", error);

    res.status(500).json({
      error: "Could not load repair requests."
    });
  }
});

router.post("/", async (req, res) => {
  const {
    room_block,
    room_floor,
    room_number,
    item_name,
    description,
    priority
  } = req.body;

  if (
    !room_block ||
    room_floor == null ||
    room_number == null ||
    typeof item_name !== "string" ||
    !item_name.trim() ||
    typeof description !== "string" ||
    !description.trim() ||
    !["Normal", "Urgent"].includes(priority)
  ) {
    return res.status(400).json({
      error: "Please provide all required repair details."
    });
  }

  try {
    const roomResult = await pool.query(
      `SELECT 1
       FROM public.rooms
       WHERE block = $1
         AND floor = $2
         AND room_number = $3`,
      [room_block, Number(room_floor), Number(room_number)]
    );

    if (roomResult.rows.length === 0) {
      return res.status(400).json({
        error: "The selected room does not exist."
      });
    }

    // Generate a short request number on the server.
    const requestNumber =
      "REP-" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 10).toString();

    const result = await pool.query(
      `INSERT INTO public.repair_requests
       (
         request_number,
         room_block,
         room_floor,
         room_number,
         item_name,
         description,
         priority
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        requestNumber,
        room_block,
        Number(room_floor),
        Number(room_number),
        item_name.trim(),
        description.trim(),
        priority
      ]
    );

    res.status(201).json({
      message: "Repair request created successfully.",
      repair: result.rows[0]
    });
  } catch (error) {
    console.error("Create repair error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Duplicate repair request number. Please try again."
      });
    }

    res.status(500).json({
      error: "Could not create repair request."
    });
  }
});

router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;

  const repairId = Number(req.params.id);

  const allowedStatuses = [
    "Reported",
    "Assigned",
    "In Progress",
    "Completed"
  ];

  if (!Number.isInteger(repairId) || repairId <= 0) {
    return res.status(400).json({
      error: "Invalid repair request ID."
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: "Invalid repair status."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find the repair and lock its database row.
    const existing = await client.query(
      `SELECT repair_id, repair_status
       FROM public.repair_requests
       WHERE repair_id = $1
       FOR UPDATE`,
      [repairId]
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Repair request not found."
      });
    }

    // Prevent changes after completion.
    if (existing.rows[0].repair_status === "Completed") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "This repair is already Completed and cannot be changed."
      });
    }

    const result = await client.query(
      `UPDATE public.repair_requests
       SET repair_status = $1
       WHERE repair_id = $2
       RETURNING *`,
      [status, repairId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Repair status updated successfully.",
      repair: result.rows[0]
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Update repair status error:", error);

    return res.status(500).json({
      error: "Could not update repair status."
    });

  } finally {
    client.release();
  }
});

module.exports = router;
